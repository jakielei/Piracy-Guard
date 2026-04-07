import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
  try {
    const { taskId } = await params;
    const manager = require('@/lib/automation/manager');
    const db = require('@/lib/db');

    const task = db.getTask(Number(taskId));
    if (!task) {
      return NextResponse.json({ error: '任务未找到' }, { status: 404 });
    }

    if (task.status === 'paused') {
      manager.resumeTask(Number(taskId));
      return NextResponse.json({ success: true, message: '任务已恢复' });
    }

    if (task.status === 'cancelled' || task.status === 'error' || task.status === 'completed') {
      manager.executeTask(Number(taskId)).catch(err => {
        console.error('Task retry error:', err);
      });
      return NextResponse.json({ success: true, message: '任务已重新启动' });
    }

    return NextResponse.json({ error: `当前状态 ${task.status} 不支持恢复操作` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
