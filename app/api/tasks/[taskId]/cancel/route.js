import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
  try {
    const { taskId } = await params;
    const manager = require('@/lib/automation/manager');

    manager.cancelTask(Number(taskId));
    return NextResponse.json({ success: true, message: '任务已取消' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
