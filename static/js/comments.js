const API_BASE = "https://kenhunshuchong.vercel.app/api"; // 替换成你的域名

const postDiv = document.getElementById("comments");
const postId = postDiv.dataset.postId;

async function loadComments() {
  const res = await fetch(`${API_BASE}/comments?postId=${postId}`);
  const comments = await res.json();

  postDiv.innerHTML = "";

  const countDiv = document.createElement("div");
  countDiv.id = "comment-count";
  countDiv.textContent = `共有 ${comments.length} 条评论`;
  postDiv.appendChild(countDiv);

  const form = document.createElement("form");
  form.id = "comment-form";
  form.innerHTML = `
    <input type="text" id="author" placeholder="昵称" required />
    <input type="email" id="email" placeholder="邮箱（可选）" />
    <textarea id="content" placeholder="写下你的评论..." required></textarea>
    <input type="hidden" id="parentId" />
    <button type="submit">提交评论</button>
  `;
  postDiv.appendChild(form);

  const list = renderComments(comments);
  postDiv.appendChild(list);

  form.onsubmit = async e => {
    e.preventDefault();
    const data = {
      postId,
      author: document.getElementById("author").value.trim(),
      email: document.getElementById("email").value.trim(),
      content: document.getElementById("content").value.trim(),
      parentId: document.getElementById("parentId").value || null,
    };
    if (!data.author || !data.content) return alert("请填写昵称和评论内容！");

    await fetch(`${API_BASE}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    document.getElementById("author").value = "";
    document.getElementById("email").value = "";
    document.getElementById("content").value = "";
    document.getElementById("parentId").value = "";
    loadComments();
  };
}

function renderComments(comments, parentId = null) {
  const ul = document.createElement("ul");
  comments.filter(c => c.parentId === parentId).forEach(c => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${c.author}</strong> ${new Date(c.createdAt).toLocaleString()}
      <p>${c.content}</p>
      <button class="reply-btn" data-id="${c.id}">回复</button>
      <button class="like-btn" data-id="${c.id}">👍 ${c.likes || 0}</button>`;
    const children = renderComments(comments, c.id);
    if (children) li.appendChild(children);
    ul.appendChild(li);
  });
  return ul;
}

document.addEventListener("DOMContentLoaded", loadComments);

document.addEventListener("click", e => {
  if (e.target.classList.contains("reply-btn")) {
    document.getElementById("parentId").value = e.target.dataset.id;
  }
  if (e.target.classList.contains("like-btn")) {
    fetch(`${API_BASE}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: e.target.dataset.id }),
    }).then(() => loadComments());
  }
});
