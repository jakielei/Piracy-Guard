'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTasks, setSelectedTasks] = useState(new Set());
  const [deleting, setDeleting] = useState(null); // taskId being deleted
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [cacheSize, setCacheSize] = useState(null);
  const [clearing, setClearing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchTasks();
    fetchCacheSize();
  }, []);

  async function fetchTasks() {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(taskId) {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedTasks.size === tasks.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(tasks.map(t => t.id)));
    }
  }

  async function handleDelete(taskId) {
    if (!confirm('确定要删除此任务及其所有关联数据？此操作不可撤销。')) return;
    setDeleting(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setTasks(prev => prev.filter(t => t.id !== taskId));
        setSelectedTasks(prev => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      } else {
        alert('删除失败: ' + data.error);
      }
    } catch (err) {
      alert('删除失败: ' + err.message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleBulkDelete() {
    if (selectedTasks.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedTasks.size} 个任务及其所有关联数据？此操作不可撤销。`)) return;
    setBulkDeleting(true);
    try {
      const ids = [...selectedTasks];
      for (const taskId of ids) {
        await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      }
      setTasks(prev => prev.filter(t => !selectedTasks.has(t.id)));
      setSelectedTasks(new Set());
    } catch (err) {
      alert('批量删除失败: ' + err.message);
    } finally {
      setBulkDeleting(false);
      fetchTasks(); // Refresh to get accurate state
    }
  }

  async function handleExport(taskId) {
    const operatorName = prompt('请输入完成人姓名（可留空）：', '');
    if (operatorName === null) return; // User cancelled
    setExporting(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/export?operator=${encodeURIComponent(operatorName)}`);
      if (!res.ok) {
        const errData = await res.json();
        alert('导出失败: ' + errData.error);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?"?([^"]+)"?/);
      a.download = filenameMatch ? decodeURIComponent(filenameMatch[1]) : `task_${taskId}_export.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出失败: ' + err.message);
    } finally {
      setExporting(null);
    }
  }

  async function fetchCacheSize() {
    try {
      const res = await fetch('/api/cache/clear');
      const data = await res.json();
      setCacheSize(data);
    } catch (err) {
      console.error('Failed to fetch cache size:', err);
    }
  }

  async function handleClearCache() {
    if (!confirm('确定要清理浏览器缓存？\n（不会影响 Google 登录态和 Cookies）')) return;
    setClearing(true);
    try {
      const res = await fetch('/api/cache/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`✅ ${data.message}`);
        fetchCacheSize();
      } else {
        alert('清理失败: ' + data.error);
      }
    } catch (err) {
      alert('清理失败: ' + err.message);
    } finally {
      setClearing(false);
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    let relative = '';
    if (diffMin < 1) relative = '刚刚';
    else if (diffMin < 60) relative = `${diffMin} 分钟前`;
    else if (diffHours < 24) relative = `${diffHours} 小时前`;
    else if (diffDays < 30) relative = `${diffDays} 天前`;
    else relative = d.toLocaleDateString('zh-CN');

    const absolute = d.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    return `${relative}（${absolute}）`;
  }

  function getStatusInfo(task) {
    if (task.status === 'completed') return { label: '已完成', badge: 'badge-completed', icon: '✅' };
    if (task.status === 'running') return { label: '执行中', badge: 'badge-running', icon: '⚡' };
    if (task.status === 'paused') return { label: '已暂停', badge: 'badge-warning', icon: '⏸️' };
    if (task.status === 'cancelled') return { label: '已取消', badge: 'badge-error', icon: '🚫' };
    if (task.status === 'error') return { label: '出错', badge: 'badge-error', icon: '❌' };
    return { label: '待执行', badge: 'badge-pending', icon: '🕐' };
  }

  if (loading) {
    return (
      <div className="animate-fade-in">
        <h1 className="page-title">任务管理</h1>
        <p className="page-subtitle">加载中...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 className="page-title">任务管理</h1>
        <button className="btn btn-primary" onClick={() => router.push('/')}>
          ➕ 新建任务
        </button>
      </div>
      <p className="page-subtitle">管理历史检测任务 — 浏览、导出、删除</p>

      {/* Toolbar */}
      {tasks.length > 0 && (
        <div className="tasks-toolbar">
          <label className="tasks-select-all" onClick={toggleSelectAll}>
            <span className={`tasks-checkbox ${selectedTasks.size === tasks.length ? 'checked' : selectedTasks.size > 0 ? 'partial' : ''}`} />
            {selectedTasks.size > 0 ? `已选 ${selectedTasks.size} 项` : '全选'}
          </label>

          {selectedTasks.size > 0 && (
            <button
              className="btn btn-danger btn-sm"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? '删除中...' : `🗑️ 批量删除 (${selectedTasks.size})`}
            </button>
          )}

          <span className="tasks-total">共 {tasks.length} 个任务</span>
        </div>
      )}

      {/* Task List */}
      {tasks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <h3>暂无任务</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>点击"新建任务"开始你的第一次盗版检测</p>
        </div>
      ) : (
        <div className="tasks-list">
          {tasks.map(task => {
            const statusInfo = getStatusInfo(task);
            const isSelected = selectedTasks.has(task.id);
            const progress = task.total_dramas > 0
              ? Math.round(((task.completed_dramas || 0) + (task.skipped_dramas || 0)) / task.total_dramas * 100)
              : 0;

            return (
              <div
                key={task.id}
                className={`task-row ${isSelected ? 'selected' : ''}`}
              >
                {/* Checkbox */}
                <span
                  className={`tasks-checkbox ${isSelected ? 'checked' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleSelect(task.id); }}
                />

                {/* Main content — clickable to navigate */}
                <div className="task-row-main" onClick={() => router.push(`/task/${task.id}`)}>
                  <div className="task-row-header">
                    <span className="task-row-id">{task.name || `任务 #${task.id}`}</span>
                    <span className={`badge ${statusInfo.badge}`}>
                      {statusInfo.icon} {statusInfo.label}
                    </span>
                  </div>

                  <div className="task-row-stats">
                    <span>📺 {task.total_dramas} 部短剧</span>
                    <span className="task-row-sep">·</span>
                    <span>✅ {task.completed_dramas || 0} 完成</span>
                    {(task.skipped_dramas || 0) > 0 && (
                      <>
                        <span className="task-row-sep">·</span>
                        <span>⏭️ {task.skipped_dramas} 跳过</span>
                      </>
                    )}
                    <span className="task-row-sep">·</span>
                    <span>📊 进度 {progress}%</span>
                  </div>

                  <div className="task-row-time">
                    🕐 {formatDate(task.created_at)}
                  </div>
                </div>

                {/* Actions */}
                <div className="task-row-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    title="浏览任务详情"
                    onClick={(e) => { e.stopPropagation(); router.push(`/task/${task.id}`); }}
                  >
                    👁️ 浏览
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="导出 Excel"
                    disabled={exporting === task.id}
                    onClick={(e) => { e.stopPropagation(); handleExport(task.id); }}
                  >
                    {exporting === task.id ? '⏳' : '📥'} 导出
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    title="删除任务"
                    disabled={deleting === task.id}
                    onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }}
                  >
                    {deleting === task.id ? '⏳' : '🗑️'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cache Management */}
      <div className="cache-section">
        <div className="cache-info">
          <h3>🗂️ 浏览器缓存管理</h3>
          <p>清理自动化浏览器产生的缓存文件，不会影响 Google 登录态</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {cacheSize !== null && (
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              当前占用：<strong style={{ color: cacheSize.totalMB > 500 ? 'var(--warning)' : 'var(--text-primary)' }}>{cacheSize.totalFormatted}</strong>
            </span>
          )}
          <button
            className="btn btn-warning btn-sm"
            disabled={clearing}
            onClick={handleClearCache}
          >
            {clearing ? '清理中...' : '🧹 清理缓存'}
          </button>
        </div>
      </div>
    </div>
  );
}
