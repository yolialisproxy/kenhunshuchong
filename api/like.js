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

// ================== 点赞评论并更新 totalLikes（自己 + 父一级） ==================
export async function likeComment(postId, commentId) {
  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);
  if (!snapshot.exists()) throw Object.assign(new Error('评论不存在'), { isGhostLike: true });

  // 原子点赞
  const transactionResult = await runTransaction(
    ref(db, `comments/${postId}/${commentId}/likes`),
    (current) => (current || 0) + 1
  );
  const newLikes = transactionResult.snapshot.val();

  // 计算自己 totalLikes = 新的 likes + 所有子楼 likes
  const comment = snapshot.val();
  let total = newLikes;
  if (comment.children && comment.children.length > 0) {
    for (let childId of comment.children) {
      const childSnap = await get(ref(db, `comments/${postId}/${childId}`));
      if (childSnap.exists()) total += childSnap.val().likes || 0;
    }
  }
  await set(ref(db, `comments/${postId}/${commentId}/totalLikes`), total);

  // 更新父一级 totalLikes
  if (comment.parentId && comment.parentId !== '0') {
    const parentRef = ref(db, `comments/${postId}/${comment.parentId}`);
    const parentSnap = await get(parentRef);
    if (parentSnap.exists()) {
      const parent = parentSnap.val();
      let parentTotal = parent.likes || 0;
      if (parent.children && parent.children.length > 0) {
        for (let siblingId of parent.children) {
          const siblingSnap = await get(ref(db, `comments/${postId}/${siblingId}`));
          if (siblingSnap.exists()) parentTotal += siblingSnap.val().likes || 0;
        }
      }
      await set(ref(db, `comments/${postId}/${comment.parentId}/totalLikes`), parentTotal);
    }
  }

  return total;
}

// ================== API Handler ==================
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let postId, commentId;

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
