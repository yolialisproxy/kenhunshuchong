import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, push, get, child, remove, update } from "firebase/database";

// 初始化 Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// 提交评论
export async function submitComment(req, res) {
  try {
    const { postId, name, email, comment } = req.body;
    if (!postId || !name || !email || !comment) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const commentRef = ref(database, 'comments/' + postId);
    const newCommentRef = push(commentRef);

    await set(newCommentRef, {
      name,
      email,
      comment,
      date: Date.now(),
    });

    res.status(200).json({ message: 'Comment submitted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to submit comment' });
  }
}

// 获取评论（分页）
export async function getComments(req, res) {
  try {
    const { postId, page = 1, limit = 5 } = req.query;
    if (!postId) {
      return res.status(400).json({ error: 'postId is required' });
    }

    const commentRef = ref(database, 'comments/' + postId);
    const snapshot = await get(commentRef);

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'No comments found' });
    }

    const comments = [];
    snapshot.forEach(childSnapshot => {
      comments.push({
        id: childSnapshot.key,
        ...childSnapshot.val()
      });
    });

    // 排序：按日期倒序
    comments.sort((a, b) => b.date - a.date);

    const startIndex = (page - 1) * limit;
    const paginatedComments = comments.slice(startIndex, startIndex + limit);

    res.status(200).json({
      comments: paginatedComments,
      totalPages: Math.ceil(comments.length / limit),
      currentPage: page
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
}

// 删除评论
export async function deleteComment(req, res) {
  try {
    const { postId, commentId } = req.query;
    if (!postId || !commentId) {
      return res.status(400).json({ error: 'postId and commentId are required' });
    }

    const commentRef = ref(database, 'comments/' + postId + '/' + commentId);
    await remove(commentRef);

    res.status(200).json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
}

// 编辑评论
export async function editComment(req, res) {
  try {
    const { postId, commentId, comment } = req.body;
    if (!postId || !commentId || !comment) {
      return res.status(400).json({ error: 'postId, commentId, and comment are required' });
    }

    const commentRef = ref(database, 'comments/' + postId + '/' + commentId);
    await update(commentRef, { comment });

    res.status(200).json({ message: 'Comment updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
}
