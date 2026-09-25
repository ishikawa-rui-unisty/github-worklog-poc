import type { WorkLog } from "../model/work-log.js";

/**
 * commentId の現在状態を反映する。next が null なら明細を削除する。
 * created / edited / deleted のイベント種別には依存しない。
 */
export function syncWorkLog(
  current: readonly WorkLog[],
  commentId: number,
  next: WorkLog | null,
): WorkLog[] {
  if (next !== null && next.commentId !== commentId) {
    throw new Error("WorkLog commentId does not match the sync key");
  }

  const byCommentId = new Map(current.map((log) => [log.commentId, log]));
  if (next === null) {
    byCommentId.delete(commentId);
  } else {
    byCommentId.set(commentId, next);
  }
  return [...byCommentId.values()];
}
