import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, runTransaction } from 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ================== 智能 body 解析 ==================
async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch {}
    try { return Object.fromEntries(new URLSearchParams(req.body)); } catch {}
  }
  return {};
}

// ================== 递归计算 totalLikes ==================
async function computeTotalLikes(postId, commentId) {
  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);
  if (!snapshot.exists()) return 0;

  const comment = snapshot.val();
  let total = comment.likes || 0;

  if (comment.children && comment.children.length > 0) {
    for (const child of comment.children) {
      total += await computeTotalLikes(postId, child.id);
    }
  }

  await set(ref(db, `comments/${postId}/${commentId}/totalLikes`), total);
  return total;
}

// ================== 点赞评论 ==================
export async function likeComment(postId, commentId) {
  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);
  if (!snapshot.exists()) throw Object.assign(new Error('评论不存在'), { isGhostLike: true });

  // 原子点赞
  await runTransaction(ref(db, `comments/${postId}/${commentId}/likes`), (current) => (current || 0) + 1);

  // 递归更新 totalLikes（包括自己和所有父节点）
  async function updateAncestorsTotalLikes(currCommentId) {
    const currSnapshot = await get(ref(db, `comments/${postId}/${currCommentId}`));
    if (!currSnapshot.exists()) return;

    await computeTotalLikes(postId, currCommentId);

    const curr = currSnapshot.val();
    if (curr.parentId && curr.parentId !== '0') {
      await updateAncestorsTotalLikes(curr.parentId);
    }
  }

  await updateAncestorsTotalLikes(commentId);

  const updatedSnapshot = await get(commentRef);
  return updatedSnapshot.val().totalLikes || 0;
}

// ================== API Handler ==================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = await parseBody(req);
  const { postId, commentId } = body;

  if (!postId || !commentId) {
    return res.status(400).json({ success: false, message: "缺少 postId 或 commentId" });
  }

  try {
    const totalLikes = await likeComment(postId, commentId);
    return res.status(200).json({ success: true, totalLikes });
  } catch (error) {
    console.error('❌ 点赞错误:', error);

    if (error.isGhostLike) {
      return res.status(410).json({
        success: false,
        message: "评论不存在",
        ghostLike: true
      });
    }

    return res.status(500).json({
      success: false,
      message: "点赞失败",
      details: error.message
    });
  }
}
