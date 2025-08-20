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

// ======================== 递归更新 totalLikes ========================
async function updateTotalLikes(postId, commentId) {
  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);
  if (!snapshot.exists()) return 0;

  const comment = snapshot.val();
  let total = comment.likes || 0;

  if (comment.children && comment.children.length > 0) {
    for (let childId of comment.children) {
      total += await updateTotalLikes(postId, childId);
    }
  }

  await set(ref(db, `comments/${postId}/${commentId}/totalLikes`), total);

  return total;
}

// ================== 点赞评论 ==================
export async function likeComment(postId, commentId) {
  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);

  if (!snapshot.exists()) {
    const err = new Error('评论不存在');
    err.code = 404;
    throw err;
  }

  // 原子点赞（无悔 +1）
  await runTransaction(ref(db, `comments/${postId}/${commentId}/likes`), (current) => (current || 0) + 1);

  // 更新 totalLikes
  return await updateTotalLikes(postId, commentId);
}

// ================== API Handler ==================
export default async function handler(req, res) {
  // ================= CORS =================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let postId, commentId;

  // 解析 req.body
  if (req.body && typeof req.body === 'object') {
    ({ postId, commentId } = req.body);
  } else if (req.body && typeof req.body === 'string') {
    try {
      ({ postId, commentId } = JSON.parse(req.body));
    } catch {
      return res.status(400).json({ success: false, message: "请求 body 无效" });
    }
  }

  if (!postId || !commentId) {
    return res.status(400).json({ success: false, message: "缺少 postId 或 commentId" });
  }

  try {
    const totalLikes = await likeComment(postId, commentId);
    return res.status(200).json({ success: true, totalLikes });
  } catch (error) {
    console.error('❌ 点赞错误:', error);

    if (error.code === 404) {
      return res.status(404).json({ success: false, message: "评论不存在" });
    }

    return res.status(500).json({ success: false, message: "点赞失败", details: error.message });
  }
}
