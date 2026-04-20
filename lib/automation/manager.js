const { queryBackendForDrama, closeBrowser, getBrowserContext } = require('./backend-query');
const { searchGoogle } = require('./google-search');
const db = require('../db');

const taskStates = new Map();
const listeners = new Map();
const taskControllers = new Map();

function getTaskState(taskId) {
  return taskStates.get(taskId) || { status: 'idle', currentDrama: null, message: '' };
}

function addListener(taskId, listener) {
  if (!listeners.has(taskId)) {
    listeners.set(taskId, new Set());
  }
  listeners.get(taskId).add(listener);
}

function removeListener(taskId, listener) {
  const set = listeners.get(taskId);
  if (set) {
    set.delete(listener);
    if (set.size === 0) listeners.delete(taskId);
  }
}

function notifyListeners(taskId, event) {
  const set = listeners.get(taskId);
  if (set) {
    for (const listener of set) {
      listener(event);
    }
  }
}

function emit(taskId, type, data) {
  const event = { type, ...data, timestamp: Date.now() };
  taskStates.set(taskId, { ...getTaskState(taskId), ...data });
  notifyListeners(taskId, event);
}

function pauseTask(taskId) {
  const controller = taskControllers.get(taskId);
  if (controller) {
    controller.paused = true;
    db.updateTask(taskId, { status: 'paused' });
    emit(taskId, 'task_paused', { status: 'paused', message: '任务已暂停' });
  }
}

function resumeTask(taskId) {
  const controller = taskControllers.get(taskId);
  if (controller && controller.paused) {
    controller.paused = false;
    db.updateTask(taskId, { status: 'running' });
    emit(taskId, 'task_resumed', { status: 'running', message: '任务已恢复' });
    if (controller.resumeResolve) {
      controller.resumeResolve();
      controller.resumeResolve = null;
    }
  }
}

function cancelTask(taskId) {
  const controller = taskControllers.get(taskId);
  if (controller) {
    controller.cancelled = true;
    controller.paused = false;
    db.updateTask(taskId, { status: 'cancelled' });
    emit(taskId, 'task_cancelled', { status: 'cancelled', message: '任务已取消' });
    if (controller.resumeResolve) {
      controller.resumeResolve();
      controller.resumeResolve = null;
    }
  }
}

async function waitForResume(taskId) {
  const controller = taskControllers.get(taskId);
  if (!controller || !controller.paused) return;

  emit(taskId, 'waiting_for_resume', {
    status: 'paused',
    message: '任务已暂停，点击"继续"按钮恢复...',
  });

  return new Promise((resolve) => {
    controller.resumeResolve = resolve;
  });
}

async function checkCancelled(taskId) {
  const controller = taskControllers.get(taskId);
  return controller && controller.cancelled;
}

async function executeTask(taskId, fastMode = false) {
  const task = db.getTask(taskId);
  if (!task) throw new Error('Task not found');

  const controller = { paused: false, cancelled: false, resumeResolve: null };
  taskControllers.set(taskId, controller);

  db.updateTask(taskId, { status: 'running' });
  emit(taskId, 'task_started', { status: 'running', message: '任务已启动，正在初始化浏览器...' });

  const dramas = db.getDramasByTask(taskId);
  let completedCount = 0;
  let currentDramaIndex = 0;

  try {
    for (let i = 0; i < dramas.length; i++) {
      if (await checkCancelled(taskId)) {
        emit(taskId, 'task_cancelled', { status: 'cancelled', message: '任务已取消' });
        return;
      }

      while (taskControllers.get(taskId)?.paused) {
        await waitForResume(taskId);
        if (await checkCancelled(taskId)) {
          emit(taskId, 'task_cancelled', { status: 'cancelled', message: '任务已取消' });
          return;
        }
      }

      const drama = dramas[i];
      currentDramaIndex = i;

      emit(taskId, 'drama_start', {
        currentDrama: drama.drama_id,
        message: `正在查询: ${drama.drama_id}`,
      });

      db.updateDrama(drama.id, { status: 'querying' });
      emit(taskId, 'drama_querying', {
        message: `正在后台查询: ${drama.drama_id}`,
      });

      try {
        const info = await queryBackendForDrama(drama.drama_id, (progress) => {
          if (progress.type === 'login_required') {
            emit(taskId, 'login_required', {
              status: 'waiting_login',
              message: progress.message,
            });
          } else if (progress.type === 'login_success') {
            emit(taskId, 'login_success', {
              message: progress.message,
            });
          }
        });

        if (await checkCancelled(taskId)) {
          emit(taskId, 'task_cancelled', { status: 'cancelled', message: '任务已取消' });
          return;
        }

        while (taskControllers.get(taskId)?.paused) {
          await waitForResume(taskId);
          if (await checkCancelled(taskId)) return;
        }

        if (!info.found) {
          db.updateDrama(drama.id, { status: 'error', error_message: '后台未找到该短剧' });
          emit(taskId, 'drama_error', {
            message: `${drama.drama_id} 未找到`,
          });
          completedCount++;
          continue;
        }

        db.updateDrama(drama.id, {
          name: info.name,
          chinese_name: info.chineseName || info.name,
          cp_name: info.cpName,
          is_self_made: info.isSelfMade ? 1 : 0,
          content_type: info.contentType,
        });

        if (!info.isSelfMade) {
          db.updateDrama(drama.id, { status: 'skipped' });
          emit(taskId, 'drama_skipped', {
            message: `${info.name || drama.drama_id} 为引入短剧，已跳过`,
          });
          completedCount++;
          continue;
        }

        const searchName = info.name || drama.input_name;
        if (!searchName) {
          db.updateDrama(drama.id, { status: 'error', error_message: '无法获取搜索名称' });
          completedCount++;
          continue;
        }

        db.updateDrama(drama.id, { status: 'searching' });
        emit(taskId, 'drama_searching', {
          message: `正在 Google 搜索: ${searchName}`,
        });

        const results = await searchGoogle(searchName, (progress) => {
          if (progress.type === 'captcha') {
            emit(taskId, 'captcha', { status: 'captcha', message: progress.message });
          } else if (progress.type === 'page') {
            emit(taskId, 'search_page', {
              message: `搜索 ${searchName} - 第 ${progress.page} 页`,
            });
          }
        });

        if (results.length > 0) {
          emit(taskId, 'matcher_running', {
            message: `正在运用匹配算法对 ${results.length} 条结果进行筛查...`,
          });
          const { matchResult } = require('./matcher');
          const context = await getBrowserContext();

          for (let k = 0; k < results.length; k++) {
            if (k % 5 === 0 || k === results.length - 1) {
              emit(taskId, 'matcher_running', { message: `正在运用匹配算法对 ${results.length} 条结果进行筛查... (进度: ${k + 1}/${results.length})` });
            }
            if (await checkCancelled(taskId)) {
              emit(taskId, 'task_cancelled', { status: 'cancelled', message: '任务已取消' });
              return;
            }
            while (taskControllers.get(taskId)?.paused) {
              await waitForResume(taskId);
              if (await checkCancelled(taskId)) return;
            }

            const mr = await matchResult(results[k], searchName, context, fastMode);
            results[k].match_status = mr.match_status;
            results[k].match_reason = mr.match_reason;
          }

          db.addSearchResults(drama.id, results);
        }

        db.updateDrama(drama.id, { status: 'completed' });
        emit(taskId, 'drama_completed', {
          message: `${searchName} 完成，找到 ${results.length} 条结果`,
        });
      } catch (error) {
        if (error.message === 'LOGIN_WAIT_TIMEOUT') {
          db.updateDrama(drama.id, { status: 'error', error_message: '登录等待超时（5分钟），请重试' });
          emit(taskId, 'drama_error', {
            message: `⏰ 登录等待超时 (${drama.drama_id})，请手动登录后重试`,
          });
          pauseTask(taskId);
          return;
        }

        db.updateDrama(drama.id, {
          status: 'error',
          error_message: error.message,
        });
        emit(taskId, 'drama_error', {
          message: `${drama.drama_id} 出错: ${error.message}`,
        });
      }

      completedCount++;
      db.updateTask(taskId, { completed_dramas: completedCount });
    }

    db.updateTask(taskId, { status: 'completed', completed_dramas: completedCount });
    emit(taskId, 'task_completed', { status: 'completed', message: '✅ 所有短剧处理完成' });
  } catch (error) {
    db.updateTask(taskId, { status: 'error' });
    emit(taskId, 'task_error', { status: 'error', message: error.message });
  } finally {
    taskControllers.delete(taskId);
    // Do not close the browser context to persist SSO login sessions across tasks
    // await closeBrowser();
  }
}

module.exports = {
  executeTask,
  getTaskState,
  addListener,
  removeListener,
  pauseTask,
  resumeTask,
  cancelTask,
};
