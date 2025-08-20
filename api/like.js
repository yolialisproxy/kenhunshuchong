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

// ======================== 更新 totalLikes（当前 + 一级父） ========================
async function updateTotalLikes(postId, commentId) {
  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);
  if (!snapshot.exists()) return 0;

  const comment = snapshot.val();
  const likes = comment.likes || 0;

  // 如果有 children 数组，累加子楼的 likes
  let total = likes;
  if (comment.children && comment.children.length > 0) {
    for (let childId of comment.children) {
      const childSnap = await get(ref(db, `comments/${postId}/${childId}`));
      if (childSnap.exists()) {
        const child = childSnap.val();
        total += child.likes || 0;
      }
    }
  }

  // 更新当前楼 totalLikes
  await set(ref(db, `comments/${postId}/${commentId}/totalLikes`), total);

  // 如果有一级父楼，也更新父楼 totalLikes
  if (comment.parentId && comment.parentId !== '0') {
    const parentRef = ref(db, `comments/${postId}/${comment.parentId}`);
    const parentSnap = await get(parentRef);
    if (parentSnap.exists()) {
      const parent = parentSnap.val();
      let parentTotal = parent.likes || 0;

      // 父楼的 children 数组里每个子楼的 likes 累加
      if (parent.children && parent.children.length > 0) {
        for (let siblingId of parent.children) {
          const siblingSnap = await get(ref(db, `comments/${postId}/${siblingId}`));
          if (siblingSnap.exists()) {
            const sibling = siblingSnap.val();
            parentTotal += sibling.likes || 0;
          }
        }
      }

      await set(ref(db, `comments/${postId}/${comment.parentId}/totalLikes`), parentTotal);
    }
  }

  return total;
}

// ================== 点赞评论 ==================
export async function likeComment(postId, commentId) {
  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);

  if (!snapshot.exists()) {
    // 🚨 幽灵点赞（评论不存在）
    console.warn(`⚠️ 幽灵点赞: postId=${postId}, commentId=${commentId}`);
    const err = new Error('评论不存在');
    err.isGhostLike = true;
    throw err;
  }

  // 原子点赞（无悔 +1）
  await runTransaction(ref(db, `comments/${postId}/${commentId}/likes`), (current) => (current || 0) + 1);

  // 更新 totalLikes（自己 + 父一级）
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
