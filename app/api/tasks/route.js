import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const db = require('@/lib/db');
    const { text } = await request.json();

    if (!text || !text.trim()) {
      return NextResponse.json({ error: '请输入短剧列表' }, { status: 400 });
    }

    const dramaList = db.parseDramaInput(text);
    if (dramaList.length === 0) {
      return NextResponse.json({ error: '未能解析出任何短剧ID' }, { status: 400 });
    }

    const taskId = db.createTask(dramaList);
    return NextResponse.json({ taskId, count: dramaList.length });
  } catch (error) {
    console.error('Error creating task:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = require('@/lib/db');
    const tasks = db.getAllTasks();
    return NextResponse.json({ tasks });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
