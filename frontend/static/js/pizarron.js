const canvas = document.getElementById("boardCanvas");
const ctx = canvas.getContext("2d");
const boardSurface = document.getElementById("boardSurface");
const colorPicker = document.getElementById("colorPicker");
const lineWidthInput = document.getElementById("lineWidth");
const toolButtons = document.querySelectorAll(".tool-btn");
const clearButton = document.getElementById("clearBoard");
const toolControls = document.getElementById("toolControls");
const styleControls = document.getElementById("styleControls");
const clearControls = document.getElementById("clearControls");
const readOnlyNotice = document.getElementById("readOnlyNotice");
const boardStatus = document.getElementById("boardStatus");
const API = window.location.origin;
const token = sessionStorage.getItem("sia_token");
const parametrosPagina = new URLSearchParams(window.location.search);
const docenteMateriaId = parametrosPagina.get("materia");
const grupoId = parametrosPagina.get("grupo");
const soloLectura = parametrosPagina.get("modo") === "ver";

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

const esEstudiante = obtenerUsuario().rol === "estudiante";
const socket = token && typeof io === "function" ? io(API, { auth: { token } }) : null;

let puedeDibujar = false;
let cargaRecibida = false;
let currentTool = "pen";
let drawing = false;
let currentColor = colorPicker.value;
let currentWidth = Number(lineWidthInput.value);
let currentPath = [];
let textInput = null;
let eventosPendientes = [];

const strokes = [];
const textNodes = [];
const idsTrazos = new Set();

function informar(mensaje) {
  boardStatus.textContent = mensaje;
}

function actualizarPermisos(permisoServidor) {
  puedeDibujar = Boolean(permisoServidor) && !soloLectura && !esEstudiante;
  [toolControls, styleControls, clearControls].forEach((control) => {
    control.hidden = !puedeDibujar;
  });
  readOnlyNotice.hidden = puedeDibujar;
  canvas.style.cursor = puedeDibujar ? "crosshair" : "default";
  canvas.setAttribute("aria-readonly", String(!puedeDibujar));
}

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
  idsTrazos.clear();
  redrawStrokes();
}

function setActiveTool(tool) {
  if (!puedeDibujar) return;
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

function crearNodoTexto(trazo) {
  const node = document.createElement("div");
  node.className = "text-node";
  node.textContent = trazo.texto;
  node.style.left = `${trazo.x}px`;
  node.style.top = `${trazo.y}px`;
  node.style.color = trazo.color;
  boardSurface.appendChild(node);
  textNodes.push(node);
}

function normalizarTrazo(datos) {
  let trazo = datos?.datos_trazo || datos?.trazo || datos;
  if (typeof trazo === "string") {
    try {
      trazo = JSON.parse(trazo);
    } catch {
      return null;
    }
  }
  if (!trazo || typeof trazo !== "object") return null;

  if (trazo.tipo === "texto" && typeof trazo.texto === "string") {
    return {
      tipo: "texto",
      texto: trazo.texto,
      x: Number(trazo.x),
      y: Number(trazo.y),
      color: trazo.color || "#1f2937",
    };
  }
  if (!Array.isArray(trazo.points) || trazo.points.length < 2) return null;
  return {
    tipo: "trazo",
    points: trazo.points,
    color: trazo.color || "#1f2937",
    width: Number(trazo.width) || 4,
  };
}

function aplicarTrazo(evento) {
  const id = evento?.id;
  if (id && idsTrazos.has(id)) return;
  const trazo = normalizarTrazo(evento);
  if (!trazo) return;
  if (id) idsTrazos.add(id);

  if (trazo.tipo === "texto") {
    crearNodoTexto(trazo);
  } else {
    strokes.push(trazo);
    redrawStrokes();
  }
}

function aplicarEventoPendiente(evento) {
  if (evento.tipo === "limpiar") {
    limpiarPizarron();
  } else {
    aplicarTrazo(evento.payload);
  }
}

function iniciarDibujo(event) {
  if (!puedeDibujar) return;
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

function enviarTrazo(trazo) {
  if (!puedeDibujar || !socket?.connected) {
    informar("No hay conexión; el cambio no se guardó.");
    return;
  }
  socket.emit("pizarron:trazo", trazo, (respuesta) => {
    if (!respuesta?.ok) informar(respuesta?.mensaje || "No se pudo guardar el cambio.");
  });
}

function dibujar(event) {
  if (!drawing || !puedeDibujar) return;

  const pos = getPointerPosition(event);
  const previousPoint = currentPath[currentPath.length - 1];
  currentPath.push(pos);

  const esBorrador = currentTool === "eraser";
  const trazo = {
    tipo: "trazo",
    herramienta: esBorrador ? "borrador" : "lapiz",
    points: [previousPoint, pos],
    color: esBorrador ? "#ffffff" : currentColor,
    width: esBorrador ? 24 : currentWidth,
  };
  enviarTrazo(trazo);

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
      tipo: "trazo",
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

  const trazo = {
    tipo: "texto",
    texto: value,
    x: pos.x,
    y: pos.y,
    color: currentColor,
  };
  crearNodoTexto(trazo);
  enviarTrazo(trazo);
  if (textInput) {
    textInput.remove();
    textInput = null;
  }
}

if (socket) {
  socket.on("connect", () => {
    cargaRecibida = false;
    eventosPendientes = [];
    informar("Conectado; cargando el pizarrón…");
    if (docenteMateriaId) {
      socket.emit("unirse-materia", { docente_materia_id: docenteMateriaId });
    } else if (grupoId) {
      socket.emit("unirse-grupo", { grupo_id: grupoId });
    } else {
      informar("Falta indicar la materia o el curso.");
    }
  });

  socket.on("pizarron:carga", (datos) => {
    limpiarPizarron();
    (datos?.trazos || []).forEach(aplicarTrazo);
    cargaRecibida = true;
    eventosPendientes.forEach(aplicarEventoPendiente);
    eventosPendientes = [];
    actualizarPermisos(datos?.puede_dibujar);
    informar(puedeDibujar ? "Pizarrón listo." : "Pizarrón en modo de solo lectura.");
  });

  socket.on("pizarron:trazo", (payload) => {
    if (!cargaRecibida) {
      eventosPendientes.push({ tipo: "trazo", payload });
      return;
    }
    aplicarTrazo(payload);
  });

  socket.on("pizarron:limpiar", () => {
    if (!cargaRecibida) {
      eventosPendientes.push({ tipo: "limpiar" });
      return;
    }
    limpiarPizarron();
  });

  socket.on("pizarron:error", ({ mensaje }) => informar(mensaje || "Error al guardar en el pizarrón."));
  socket.on("error-autorizacion", ({ mensaje }) => {
    actualizarPermisos(false);
    informar(mensaje || "No tienes acceso a este pizarrón.");
  });
  socket.on("disconnect", () => {
    actualizarPermisos(false);
    informar("Conexión perdida; cambios deshabilitados.");
  });
  socket.on("connect_error", () => {
    actualizarPermisos(false);
    informar("No se pudo conectar al pizarrón.");
  });
} else {
  informar("Inicia sesión para ver el pizarrón.");
}

canvas.addEventListener("pointerdown", iniciarDibujo);
canvas.addEventListener("pointermove", dibujar);
canvas.addEventListener("pointerup", finalizarDibujo);
canvas.addEventListener("pointercancel", finalizarDibujo);

clearButton.addEventListener("click", () => {
  if (!puedeDibujar || !socket?.connected) return;
  if (!window.confirm("¿Borrar todo el contenido de este pizarrón?")) return;
  socket.emit("pizarron:limpiar", {}, (respuesta) => {
    if (!respuesta?.ok) {
      informar(respuesta?.mensaje || "No se pudo borrar el pizarrón.");
      return;
    }
    limpiarPizarron();
    informar("Pizarrón borrado.");
  });
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

document.addEventListener("keydown", (event) => {
  if (!puedeDibujar) return;
  if (event.key.toLowerCase() === "p") setActiveTool("pen");
  if (event.key.toLowerCase() === "b") setActiveTool("eraser");
  if (event.key.toLowerCase() === "t") setActiveTool("text");
});

if (esEstudiante || soloLectura) {
  document.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("dragstart", (event) => event.preventDefault());
}

actualizarPermisos(false);
window.addEventListener("resize", resizeCanvas);
window.addEventListener("load", resizeCanvas);
