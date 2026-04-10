import { NextResponse } from 'next/server';

let isRematching = false;
let rematchProgress = { total: 0, processed: 0 };

export async function GET() {
  return NextResponse.json({ isRematching, progress: rematchProgress });
}

export async function POST(request) {
  if (isRematching) {
    return NextResponse.json({ success: false, error: '正在进行全盘重新匹配，请耐心等待' });
  }
  
  const body = await request.json().catch(() => ({}));
  const targetTaskId = body.taskId;
  if (!targetTaskId) {
    return NextResponse.json({ success: false, error: '缺少必需的 taskId 参数' });
  }

  isRematching = true;
  rematchProgress = { total: 0, processed: 0 };

  // 放入后台异步执行以避免 Vercel/NextJS 的响应超时
  (async () => {
    try {
      // 动态引入以防在边缘环境中报错
      const db = require('../../../lib/db');
      const { getBrowserContext } = require('../../../lib/automation/backend-query');
      const { matchResult } = require('../../../lib/automation/matcher');
      
      const rawDb = db.getDb();
      
      const resultsToProcess = rawDb.prepare(`
        SELECT sr.*, d.name as drama_name 
        FROM search_results sr
        JOIN dramas d ON sr.drama_db_id = d.id
        WHERE d.task_id = ?
      `).all(Number(targetTaskId));
      
      rematchProgress.total = resultsToProcess.length;
      
      if (resultsToProcess.length === 0) {
        isRematching = false;
        return;
      }

      const context = await getBrowserContext();
      // 使用事物防止单条失败，但对于大批量，单条事务过于消耗，不严格要求全成功
      const updateStmt = rawDb.prepare("UPDATE search_results SET match_status = ?, match_reason = ?, is_pirated = CASE WHEN ? = 'piracy' THEN 1 ELSE is_pirated END WHERE id = ?");

      for (const res of resultsToProcess) {
        const mr = await matchResult(res, res.drama_name || '', context);
        updateStmt.run(mr.match_status, mr.match_reason, mr.match_status, res.id);
        rematchProgress.processed++;
      }
    } catch (e) {
      console.error('[Rematch] Background error:', e);
    } finally {
      isRematching = false;
    }
  })();

  return NextResponse.json({ success: true, message: '已触发批量重新筛查任务' });
}
