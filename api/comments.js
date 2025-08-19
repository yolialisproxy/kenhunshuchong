const API_BASE = "https://kenhunshuchong.vercel.app/api/comments";
const commentsContainer = document.getElementById("comments-list");
const postId = commentsContainer?.dataset.postId;

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, tag =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[tag] || tag)
  );
}

function showToast(msg, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function renderComment(c) {
  const wrapper = document.createElement("div");
  wrapper.className = "comment";
  wrapper.innerHTML = `
    <div class="comment-header">
      <strong>${escapeHTML(c.name)}</strong>
      <span class="comment-date">${new Date(c.date).toLocaleString()}</span>
    </div>
    <div class="comment-body">${escapeHTML(c.comment)}</div>
    <div class="comment-actions">
      <button class="like-btn" data-id="${c.id}">👍 ${c.likes || 0}</button>
    </div>
  `;

  // 点赞逻辑（可拓展）
  wrapper.querySelector(".like-btn").addEventListener("click", async e => {
    showToast("点赞功能可在后端拓展");
  });

  return wrapper;
}

async function loadComments() {
  commentsContainer.innerHTML = "<p>加载中...</p>";
  try {
    const res = await fetch(`${API_BASE}?postId=${postId}`);
    if (!res.ok) throw new Error("加载失败");
    const data = await res.json();
    commentsContainer.innerHTML = "";
    if (data.length === 0) {
      commentsContainer.innerHTML = "<p>暂无评论</p>";
      return;
    }
    data.forEach(c => commentsContainer.appendChild(renderComment(c)));
  } catch (err) {
    commentsContainer.innerHTML = "<p>加载失败</p>";
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadComments();

  const form = document.getElementById("comment-form");
  form?.addEventListener("submit", async e => {
    e.preventDefault();
    const name = document.getElementById("name").value;
    const email = document.getElementById("email").value;
    const comment = document.getElementById("comment").value;
    const data = { postId, name, email, comment };

    try {
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("提交失败");
      form.reset();
      showToast("评论提交成功！");
      loadComments();
    } catch (err) {
      showToast("评论提交失败", "error");
      console.error(err);
    }
  });
});
