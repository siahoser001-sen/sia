const canvas = document.getElementById("boardCanvas");
const ctx = canvas.getContext("2d");
const boardSurface = document.getElementById("boardSurface");
const colorPicker = document.getElementById("colorPicker");
const lineWidthInput = document.getElementById("lineWidth");
const toolButtons = document.querySelectorAll(".tool-btn");
const clearButton = document.getElementById("clearBoard");
const saveButton = document.getElementById("saveBoard");
const API = window.location.origin;
const token = sessionStorage.getItem("sia_token");
const docenteMateriaId = new URLSearchParams(window.location.search).get("materia");

function obtenerUsuario() {
  const usuarioGuardado = JSON.parse(sessionStorage.getItem("sia_usuario") || "null");
  if (usuarioGuardado?.rol) return usuarioGuardado;
  if (!token) return {};

  try {
    let payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    payload += "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(payload));
  } catch {
    return {};
  }
}

const esDocente = obtenerUsuario().rol === "docente";
const socket = token && typeof io === "function" ? io(API, { auth: { token } }) : null;

let currentTool = "pen";
let drawing = false;
let currentColor = colorPicker.value;
let currentWidth = Number(lineWidthInput.value);
let currentPath = [];
let textInput = null;

const strokes = [];
const textNodes = [];

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = boardSurface.getBoundingClientRect();
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redrawStrokes();
}

function redrawStrokes() {
  const { width, height } = boardSurface.getBoundingClientRect();
  ctx.clearRect(0, 0, width, height);
  strokes.forEach((stroke) => {
    if (!stroke.points || stroke.points.length < 2) return;
    ctx.beginPath();
    ctx.lineWidth = stroke.width;
    ctx.strokeStyle = stroke.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  });
}

function limpiarPizarron() {
  strokes.length = 0;
  textNodes.forEach((node) => node.remove());
  textNodes.length = 0;
  redrawStrokes();
}

function setActiveTool(tool) {
  currentTool = tool;
  toolButtons.forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  if (textInput) {
    textInput.remove();
    textInput = null;
  }
}

function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function iniciarDibujo(event) {
  if (currentTool === "text") {
    const pos = getPointerPosition(event);
    if (textInput) {
      textInput.remove();
      textInput = null;
    }
    textInput = document.createElement("textarea");
    textInput.className = "text-input";
    textInput.style.left = `${pos.x}px`;
    textInput.style.top = `${pos.y}px`;
    textInput.placeholder = "Escribe aquí";
    boardSurface.appendChild(textInput);
    textInput.focus();
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finalizeText(textInput.value, pos);
      }
      if (e.key === "Escape") {
        textInput.remove();
        textInput = null;
      }
    });
    textInput.addEventListener("blur", () => {
      if (textInput) finalizeText(textInput.value, pos);
    });
    return;
  }

  if (currentTool === "pen" || currentTool === "eraser") {
    drawing = true;
    currentPath = [getPointerPosition(event)];
    canvas.setPointerCapture(event.pointerId);
  }
}

function dibujar(event) {
  if (!drawing) return;

  const pos = getPointerPosition(event);
  const previousPoint = currentPath[currentPath.length - 1];
  currentPath.push(pos);

  const trazo = {
    points: [previousPoint, pos],
    color: currentTool === "eraser" ? "#ffffff" : currentColor,
    width: currentTool === "eraser" ? 24 : currentWidth,
  };
  socket?.emit("pizarron:trazo", trazo);

  redrawStrokes();
  ctx.beginPath();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = trazo.width;
  ctx.strokeStyle = trazo.color;
  ctx.moveTo(trazo.points[0].x, trazo.points[0].y);
  ctx.lineTo(trazo.points[1].x, trazo.points[1].y);
  ctx.stroke();
}

function finalizarDibujo() {
  if (!drawing) return;
  drawing = false;
  if (currentPath.length > 1) {
    strokes.push({
      points: currentPath,
      color: currentTool === "eraser" ? "#ffffff" : currentColor,
      width: currentTool === "eraser" ? 24 : currentWidth,
    });
  }
  redrawStrokes();
  currentPath = [];
}

function finalizeText(value, pos) {
  if (!value || !value.trim()) {
    if (textInput) {
      textInput.remove();
      textInput = null;
    }
    return;
  }
  const node = document.createElement("div");
  node.className = "text-node";
  node.textContent = value;
  node.style.left = `${pos.x}px`;
  node.style.top = `${pos.y}px`;
  node.style.color = currentColor;
  boardSurface.appendChild(node);
  textNodes.push(node);
  textInput.remove();
  textInput = null;
}

if (socket) {
  socket.on("connect", () => {
    if (docenteMateriaId) {
      socket.emit("unirse-materia", { docente_materia_id: docenteMateriaId });
    }
  });

  socket.on("pizarron:trazo", (trazo) => {
    if (!trazo?.points || trazo.points.length < 2) return;
    strokes.push(trazo);
    redrawStrokes();
  });

  socket.on("pizarron:limpiar", limpiarPizarron);
}

if (esDocente) {
  canvas.addEventListener("pointerdown", iniciarDibujo);
  canvas.addEventListener("pointermove", dibujar);
  canvas.addEventListener("pointerup", finalizarDibujo);

  clearButton.addEventListener("click", () => {
    limpiarPizarron();
    socket?.emit("pizarron:limpiar");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "p") setActiveTool("pen");
    if (event.key.toLowerCase() === "b") setActiveTool("eraser");
    if (event.key.toLowerCase() === "t") setActiveTool("text");
  });
} else {
  canvas.style.cursor = "default";
  toolButtons.forEach((button) => { button.disabled = true; });
  colorPicker.disabled = true;
  lineWidthInput.disabled = true;
  clearButton.disabled = true;
}

saveButton.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "pizarron.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

colorPicker.addEventListener("input", (event) => {
  currentColor = event.target.value;
});

lineWidthInput.addEventListener("input", (event) => {
  currentWidth = Number(event.target.value);
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveTool(button.dataset.tool));
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("load", resizeCanvas);
