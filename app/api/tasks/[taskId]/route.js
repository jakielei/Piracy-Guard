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

    const rawDb = db.getDb();
    const piratedCount = rawDb.prepare(`
      SELECT COUNT(*) as count 
      FROM search_results sr 
      JOIN dramas d ON sr.drama_db_id = d.id 
      WHERE d.task_id = ? AND sr.is_pirated = 1
    `).get(Number(taskId)).count;

    return NextResponse.json({ task, dramas, piratedCount });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const db = require('@/lib/db');
    const { taskId } = await params;
    
    const rawDb = db.getDb();
    
    rawDb.transaction(() => {
      // 级联删除相关的 search_results
      rawDb.prepare(`
        DELETE FROM search_results 
        WHERE drama_db_id IN (SELECT id FROM dramas WHERE task_id = ?)
      `).run(Number(taskId));
      
      // 删除关联的短剧
      rawDb.prepare('DELETE FROM dramas WHERE task_id = ?').run(Number(taskId));
      
      // 删除主任务
      rawDb.prepare('DELETE FROM tasks WHERE id = ?').run(Number(taskId));
    })();
    
    return NextResponse.json({ success: true, message: '任务及附属数据已安全摧毁' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
