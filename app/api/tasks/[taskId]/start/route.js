import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
  try {
    const { taskId } = await params;
    const manager = require('@/lib/automation/manager');

    // Start task execution in the background (don't await)
    manager.executeTask(Number(taskId)).catch(err => {
      console.error('Task execution error:', err);
    });

    return NextResponse.json({ success: true, message: '任务已启动' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
