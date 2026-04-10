'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

const STATUS_LABELS = {
  pending: '待处理',
  querying: '查询中',
  searching: '搜索中',
  completed: '已完成',
  skipped: '已跳过',
  error: '出错',
};

const STATUS_BADGE = {
  pending: 'badge-pending',
  running: 'badge-running',
  querying: 'badge-querying',
  searching: 'badge-searching',
  completed: 'badge-completed',
  skipped: 'badge-skipped',
  error: 'badge-error',
  paused: 'badge-captcha',
  captcha: 'badge-captcha',
  waiting_login: 'badge-warning',
  cancelled: 'badge-error',
};

export default function TaskPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.taskId;

  const [task, setTask] = useState(null);
  const [dramas, setDramas] = useState([]);
  const [selectedDrama, setSelectedDrama] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [logs, setLogs] = useState([]);
  const [operatorName, setOperatorName] = useState('');
  const [piratedCount, setPiratedCount] = useState(0);
  const [fastMode, setFastMode] = useState(false);
  const [taskStarted, setTaskStarted] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState('');
  const [rematchStatus, setRematchStatus] = useState(null);
  const logRef = useRef(null);
  const eventSourceRef = useRef(null);
  const mainScrollRef = useRef(null);

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      const data = await res.json();
      setTask(data.task);
      setDramas(data.dramas);
      if (data.piratedCount !== undefined) {
        setPiratedCount(data.piratedCount);
      }
    } catch (err) {
      console.error('Failed to fetch task:', err);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  useEffect(() => {
    if (!taskStarted) return;

    const es = new EventSource(`/api/tasks/${taskId}/progress`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      addLog(data);

      if (data.type === 'login_required') {
        setLoginPrompt(data.message);
      }
      if (data.type === 'login_success') {
        setLoginPrompt('');
      }

      if (['drama_completed', 'drama_skipped', 'drama_error', 'task_completed', 'task_paused', 'task_cancelled', 'task_resumed'].includes(data.type)) {
        fetchTask();
        if (data.type === 'task_completed' || data.type === 'task_cancelled') {
          es.close();
          setTaskStarted(false);
        }
      }
    };

    es.onerror = () => {
      setTimeout(() => fetchTask(), 2000);
    };

    return () => es.close();
  }, [taskId, taskStarted, fetchTask]);

  function addLog(data) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logClass = data.type.includes('error') ? 'log-error' :
                     data.type.includes('completed') ? 'log-success' :
                     data.type.includes('captcha') || data.type.includes('login') ? 'log-warning' : '';
    setLogs(prev => [...prev.slice(-200), { time, message: data.message, class: logClass }]);

    setTimeout(() => {
      if (logRef.current) {
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
    }, 50);
  }

  async function handleStart() {
    try {
      await fetch(`/api/tasks/${taskId}/start`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fastMode })
      });
      setTaskStarted(true);
      setLogs([]);
      setLoginPrompt('');
      addLog({ type: 'info', message: '任务已启动，正在初始化浏览器...' });
      fetchTask();
    } catch (err) {
      console.error('Failed to start task:', err);
    }
  }

  async function handlePause() {
    try {
      await fetch(`/api/tasks/${taskId}/pause`, { method: 'POST' });
      addLog({ type: 'info', message: '⏸ 已发送暂停指令...' });
    } catch (err) {
      console.error('Failed to pause:', err);
    }
  }

  async function handleResume() {
    try {
      await fetch(`/api/tasks/${taskId}/resume`, { method: 'POST' });
      setTaskStarted(true);
      setLoginPrompt('');
      addLog({ type: 'info', message: '▶ 已发送继续/重试指令...' });
      fetchTask();
    } catch (err) {
      console.error('Failed to resume:', err);
    }
  }

  async function handleCancel() {
    if (!confirm('确定要取消当前任务吗？')) return;
    try {
      await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' });
      setLoginPrompt('');
      addLog({ type: 'info', message: '🛑 已发送取消指令...' });
      fetchTask();
    } catch (err) {
      console.error('Failed to cancel:', err);
    }
  }

  async function handleRematchAll() {
    if (!confirm('确定对当前任务内全部结果重新执行判定？(可能耗时数分钟)')) return;
    try {
      const res = await fetch('/api/rematch', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || '触发失败');
      } else {
        alert('后台当前任务重新判定已启动！不要关闭页面。');
        checkRematchProgress();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteTask() {
    if (!confirm('确定要彻底删除该任务的所有数据及其搜罗到的所有结果吗？此操作不可逆！')) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alert('任务及相关数据极速删除成功！');
        window.location.href = '/';
      } else {
        alert('删除失败: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('网络异常导致删除失败');
    }
  }

  function checkRematchProgress() {
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/rematch');
        const data = await res.json();
        if (data.isRematching) {
          setRematchStatus(`重判中... ${data.progress.processed}/${data.progress.total}`);
        } else {
          setRematchStatus(null);
          clearInterval(timer);
          alert('后台全盘重新判定已全部结束！');
          if (selectedDrama) handleSelectDrama(selectedDrama);
        }
      } catch (err) {
        clearInterval(timer);
        setRematchStatus(null);
      }
    }, 3000);
  }

  async function handleSelectDrama(drama) {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
    setSelectedDrama(drama);
    if (drama.status === 'completed') {
      try {
        const res = await fetch(`/api/dramas/${drama.id}/results`);
        const data = await res.json();
        setSearchResults(data.results);
      } catch (err) {
        setSearchResults([]);
      }
    } else {
      setSearchResults([]);
    }
  }

  async function handleMarkPirated(resultId, isPirated) {
    try {
      await fetch(`/api/results/${resultId}/mark`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPirated }),
      });

      setSearchResults(prev =>
        prev.map(r => r.id === resultId ? { ...r, is_pirated: isPirated ? 1 : 0 } : r)
      );
      setPiratedCount(prev => isPirated ? prev + 1 : prev - 1);
    } catch (err) {
      console.error('Failed to mark result:', err);
    }
  }

  async function handleExport() {
    const name = operatorName.trim();
    if (!name) {
      alert('请输入完成人姓名');
      return;
    }
    window.open(`/api/tasks/${taskId}/export?operator=${encodeURIComponent(name)}`, '_blank');
  }

  if (!task) {
    return (
      <div className="empty-state">
        <div className="empty-icon animate-pulse">⏳</div>
        <h3>加载中...</h3>
      </div>
    );
  }

  const completedDramas = dramas.filter(d => d.status === 'completed' || d.status === 'skipped' || d.status === 'error');
  const progress = dramas.length > 0 ? (completedDramas.length / dramas.length * 100) : 0;
  const selfMadeDramas = dramas.filter(d => d.status === 'completed');
  const skippedDramas = dramas.filter(d => d.status === 'skipped');
  const errorDramas = dramas.filter(d => d.status === 'error');

  const isRunning = task.status === 'running' || taskStarted;
  const isPaused = task.status === 'paused';
  const isCancelable = isRunning || isPaused;
  const canStart = task.status === 'pending' && !taskStarted;
  const canResume = isPaused || task.status === 'cancelled' || task.status === 'error';

  return (
    <div className="animate-fade-in">
      {/* Header with controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 className="page-title" style={{ margin: 0 }}>
            任务 #{taskId}
          </h1>
          <span className={`badge ${STATUS_BADGE[task.status] || 'badge-pending'}`} style={{ fontSize: 13, verticalAlign: 'middle' }}>
            {task.status === 'running' ? '🔄 运行中' :
             task.status === 'completed' ? '✅ 已完成' :
             task.status === 'paused' ? '⏸ 已暂停' :
             task.status === 'cancelled' ? '🛑 已取消' :
             task.status === 'error' ? '❌ 出错' :
             task.status === 'pending' ? '⏳ 待开始' : task.status}
          </span>
        </div>

        {/* Control buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn ${rematchStatus ? 'btn-secondary' : 'btn-warning'} btn-lg`} onClick={handleRematchAll} disabled={!!rematchStatus}>
            {rematchStatus || '🔮 重新判定本任务'}
          </button>
          {!isRunning && task?.status !== 'pending' && (
            <button className="btn btn-danger btn-lg" onClick={handleDeleteTask}>
              🗑️ 删除任务及数据
            </button>
          )}
          {canStart && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,0.1)', padding: '4px 12px', borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, userSelect: 'none', color: 'var(--warning)' }}>
                <input type="checkbox" checked={fastMode} onChange={e => setFastMode(e.target.checked)} style={{transform: 'scale(1.2)'}} />
                ⚡ 极速模式 (仅查 Dailymotion)
              </label>
              <button className="btn btn-primary btn-lg" onClick={handleStart}>
                🚀 启动任务
              </button>
            </div>
          )}
          {isRunning && (
            <>
              <button className="btn btn-warning btn-lg" onClick={handlePause}>
                ⏸ 暂停
              </button>
              <button className="btn btn-danger btn-lg" onClick={handleCancel}>
                🛑 取消
              </button>
            </>
          )}
          {(isPaused || canResume) && !isRunning && (
            <>
              <button className="btn btn-success btn-lg" onClick={handleResume}>
                ▶ {isPaused ? '继续' : '🔄 重试'}
              </button>
              <button className="btn btn-danger btn-lg" onClick={handleCancel}>
                🛑 取消
              </button>
            </>
          )}
          {task.status === 'completed' && (
            <button className="btn btn-primary btn-lg" onClick={handleStart}>
              🔄 重新运行
            </button>
          )}
        </div>
      </div>

      <p className="page-subtitle">
        创建于 {task.created_at} · 共 {dramas.length} 部短剧
      </p>

      {/* Login Prompt Banner */}
      {loginPrompt && (
        <div className="card" style={{
          background: 'linear-gradient(135deg, #fff3cd, #ffeeba)',
          border: '2px solid #ffc107',
          padding: '20px 24px',
          marginBottom: 20,
          borderRadius: 12,
          animation: 'pulse 2s infinite',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ fontSize: 36, lineHeight: 1 }}>🔐</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: '0 0 8px', color: '#856404', fontSize: 18, fontWeight: 700 }}>
                需要登录后台系统
              </h3>
              <p style={{ margin: 0, color: '#856404', fontSize: 14, lineHeight: 1.6 }}>
                {loginPrompt}
              </p>
              <p style={{ margin: '8px 0 0', color: '#856404', fontSize: 13 }}>
                💡 提示：请在弹出的浏览器窗口中完成钉钉/阿里云登录，登录成功后系统会自动继续。
                <br />最长等待时间：5 分钟。如需中断，请点击「取消」按钮。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent)' }}>{dramas.length}</div>
          <div className="stat-label">总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--success)' }}>{selfMadeDramas.length}</div>
          <div className="stat-label">自制（已搜索）</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--text-muted)' }}>{skippedDramas.length}</div>
          <div className="stat-label">引入（已跳过）</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--danger)' }}>{errorDramas.length}</div>
          <div className="stat-label">出错</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--warning)' }}>{piratedCount}</div>
          <div className="stat-label">已标记盗版</div>
        </div>
      </div>

      {/* Progress Bar */}
      {(taskStarted || task.status !== 'pending') && (
        <div className="progress-container">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-text">
            <span>进度 {completedDramas.length} / {dramas.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>
      )}

      {/* Log */}
      {logs.length > 0 && (
        <div className="log-container" ref={logRef} style={{ marginBottom: 24 }}>
          {logs.map((log, i) => (
            <div key={i} className={`log-entry ${log.class}`}>
              <span className="log-time">[{log.time}]</span>
              {log.message}
            </div>
          ))}
        </div>
      )}

      {/* Review Layout */}
      {dramas.some(d => d.status === 'completed') && (
        <>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, marginTop: 8 }}>
            📋 搜索结果审核
          </h2>
          <div className="review-layout">
            <div className="review-sidebar">
              <ul className="drama-list">
                {dramas.filter(d => d.status === 'completed').map(drama => (
                  <li
                    key={drama.id}
                    className={`drama-item ${selectedDrama?.id === drama.id ? 'active' : ''}`}
                    onClick={() => handleSelectDrama(drama)}
                  >
                    <div className="drama-info">
                      <div className="drama-name">{drama.name || drama.input_name}</div>
                      <div className="drama-id">{drama.drama_id}</div>
                    </div>
                    <span className={`badge ${STATUS_BADGE[drama.status]}`}>
                      {STATUS_LABELS[drama.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="review-main" ref={mainScrollRef}>
              {selectedDrama ? (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 18, fontWeight: 600 }}>
                      {selectedDrama.name || selectedDrama.input_name}
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {selectedDrama.drama_id} · {selectedDrama.cp_name || 'CP 未知'} ·
                      {selectedDrama.content_type || '类型未知'} ·
                      共 {searchResults.length} 条搜索结果
                    </p>
                  </div>

                  {searchResults.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">🔍</div>
                      <h3>暂无搜索结果</h3>
                    </div>
                  ) : (
                    searchResults.map(result => (
                      <div key={result.id} className={`result-card ${result.is_pirated === 1 ? 'marked-pirated' : ''}`}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4}}>
                           <div className="result-title" style={{maxWidth: '85%'}}>{result.title}</div>
                           {result.match_status && result.match_status !== 'unknown' && (
                             <span className={`badge ${result.match_status === 'piracy' ? 'badge-error' : result.match_status === 'safe' ? 'badge-success' : 'badge-warning'}`} style={{fontSize: 12, padding: '2px 8px', whiteSpace: 'nowrap'}}>
                               {result.match_status.toUpperCase()}
                             </span>
                           )}
                        </div>
                        <div className="result-url">{result.url}</div>
                        {result.match_reason && (
                          <div style={{fontSize: 13, color: result.match_status === 'piracy' ? 'var(--danger)' : 'var(--warning)', margin: '4px 0 8px 0', background: 'rgba(255,193,7,0.1)', padding: '4px 8px', borderRadius: 4}}>
                            <i>🤖 算法定论: {result.match_reason}</i>
                          </div>
                        )}
                        {result.snippet && (
                          <div className="result-snippet">{result.snippet}</div>
                        )}
                        <div className="result-meta">
                          <span>📄 第 {result.page_number} 页</span>
                          <span>🌐 {result.domain}</span>
                        </div>
                        <div className="result-actions">
                          {result.is_pirated === 1 ? (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleMarkPirated(result.id, false)}
                            >
                              ❌ 取消标记
                            </button>
                          ) : (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleMarkPirated(result.id, true)}
                            >
                              🏴‍☠️ 标记盗版
                            </button>
                          )}
                          <a
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm"
                          >
                            🔗 打开链接
                          </a>
                        </div>
                      </div>
                    ))
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">👈</div>
                  <h3>选择左侧短剧查看搜索结果</h3>
                  <p style={{ color: 'var(--text-muted)' }}>点击已完成的短剧来审核其 Google 搜索结果</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Export Section */}
      {dramas.some(d => d.status === 'completed') && (
        <div className="export-section">
          <div className="export-info">
            <h3>📥 导出检测结果</h3>
            <p>将所有标记为盗版的链接导出为 Excel 文件</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              className="input"
              style={{ width: 160 }}
              placeholder="完成人姓名"
              value={operatorName}
              onChange={e => setOperatorName(e.target.value)}
            />
            <button className="btn btn-success" onClick={handleExport}>
              📥 导出 Excel
            </button>
            <button className="btn btn-primary" onClick={() => {
              if (window.confirm('确定已导出全部数据并要结束本轮任务返回首页吗？')) {
                router.push('/');
              }
            }}>
              🏁 完成本轮任务返回首页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
