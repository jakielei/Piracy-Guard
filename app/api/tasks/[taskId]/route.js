import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const db = require('@/lib/db');
    const { taskId } = await params;
    const task = db.getTask(Number(taskId));

    if (!task) {
      return NextResponse.json({ error: '任务未找到' }, { status: 404 });
    }

    const dramas = db.getDramasByTask(Number(taskId));
    return NextResponse.json({ task, dramas });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
