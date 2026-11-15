const canvas = document.getElementById("boardCanvas");
const ctx = canvas.getContext("2d");
const boardSurface = document.getElementById("boardSurface");
const textBoxLayer = document.getElementById("textBoxLayer");
const colorPicker = document.getElementById("colorPicker");
const lineWidthInput = document.getElementById("lineWidth");
const toolButtons = document.querySelectorAll(".tool-btn");
const clearButton = document.getElementById("clearBoard");
const toolControls = document.getElementById("toolControls");
const styleControls = document.getElementById("styleControls");
const clearControls = document.getElementById("clearControls");
const textFormatControls = document.getElementById("textFormatControls");
const textFontInput = document.getElementById("textFont");
const textSizeInput = document.getElementById("textSize");
const textBoldButton = document.getElementById("textBold");
const textItalicButton = document.getElementById("textItalic");
const textColorInput = document.getElementById("textColor");
const deleteTextBoxButton = document.getElementById("deleteTextBox");
const readOnlyNotice = document.getElementById("readOnlyNotice");
const boardStatus = document.getElementById("boardStatus");
const API = `${window.location.protocol}//${window.location.hostname}:3000`;
const token = sessionStorage.getItem("sia_token");
const parametrosPagina = new URLSearchParams(window.location.search);
const grupoId = parametrosPagina.get("grupo");
// Cada materia tiene su propio pizarrón. 0 identifica el pizarrón del
// curso que dirige el docente y nunca se usa NULL/undefined.
const materiaId = parametrosPagina.get("materia") || "0";
const soloLectura = parametrosPagina.get("modo") === "ver";

const FUENTES_CAJA = new Set([
  "Arial",
  "Georgia",
  "Courier New",
  "Comic Sans MS",
  "Verdana",
  "Times New Roman",
]);
const CAJA_ANCHO_MINIMO = 120;
const CAJA_TEXTO_MAXIMO = 4000;

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
let cajaSeleccionada = null;
let eventosPendientes = [];

const strokes = [];
const idsTrazos = new Set();
// id -> { datos, el, content }
const cajas = new Map();
const guardadosPendientes = new Map();

function informar(mensaje) {
  boardStatus.textContent = mensaje;
}

function limitar(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo);
}

function numeroFinito(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function generarId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (caracter) => {
    const aleatorio = Math.floor(Math.random() * 16);
    const valor = caracter === "x" ? aleatorio : (aleatorio & 0x3) | 0x8;
    return valor.toString(16);
  });
}

function obtenerTamanoTablero() {
  const { width, height } = boardSurface.getBoundingClientRect();
  return { width, height };
}

function actualizarModoCajas() {
  textBoxLayer.classList.toggle("text-mode", puedeDibujar && currentTool === "text");
  canvas.style.cursor = puedeDibujar ? (currentTool === "text" ? "text" : "crosshair") : "default";
}

function actualizarPermisos(permisoServidor) {
  puedeDibujar = Boolean(permisoServidor) && !soloLectura && !esEstudiante;
  [toolControls, styleControls, clearControls].forEach((control) => {
    control.hidden = !puedeDibujar;
  });
  readOnlyNotice.hidden = puedeDibujar;
  canvas.setAttribute("aria-readonly", String(!puedeDibujar));
  textBoxLayer.classList.toggle("is-editable", puedeDibujar);
  cajas.forEach((registro) => {
    registro.content.contentEditable = String(puedeDibujar);
  });
  if (!puedeDibujar) deseleccionarCaja();
  actualizarModoCajas();
  actualizarBarraFormato();
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
  idsTrazos.clear();
  guardadosPendientes.forEach((timer) => clearTimeout(timer));
  guardadosPendientes.clear();
  cajas.forEach((registro) => registro.el.remove());
  cajas.clear();
  cajaSeleccionada = null;
  currentPath = [];
  drawing = false;
  redrawStrokes();
  actualizarBarraFormato();
}

function setActiveTool(tool) {
  if (!puedeDibujar) return;
  currentTool = tool;
  toolButtons.forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  actualizarModoCajas();
  if (tool !== "text") deseleccionarCaja();
  actualizarBarraFormato();
}

function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function parsearDatos(evento) {
  let datos = evento?.datos_trazo ?? evento?.trazo ?? evento?.caja ?? evento;
  if (typeof datos === "string") {
    try {
      datos = JSON.parse(datos);
    } catch {
      return null;
    }
  }
  return datos && typeof datos === "object" && !Array.isArray(datos) ? datos : null;
}

function normalizarTrazo(datos) {
  if (!datos || !Array.isArray(datos.points) || datos.points.length < 2) return null;
  return {
    tipo: "trazo",
    points: datos.points,
    color: datos.color || "#1f2937",
    width: Number(datos.width) || 4,
  };
}

function normalizarCaja(datos, idRespaldo) {
  if (!datos || typeof datos !== "object") return null;
  const esTextoAntiguo = datos.tipo === "texto";
  if (!esTextoAntiguo && datos.tipo !== "caja") return null;
  if (typeof datos.texto !== "string" || datos.texto.length > CAJA_TEXTO_MAXIMO) return null;

  const id = typeof datos.id === "string" && datos.id.trim() ? datos.id.trim() : idRespaldo;
  if (!id) return null;

  const x = numeroFinito(datos.x) ?? 40;
  const y = numeroFinito(datos.y) ?? 40;
  const ancho = numeroFinito(datos.ancho) ?? (esTextoAntiguo ? 360 : 320);
  const tamano = numeroFinito(datos.tamaño ?? datos.tamano) ?? 24;
  const fuente = FUENTES_CAJA.has(datos.fuente) ? datos.fuente : "Arial";
  const color = /^#[0-9a-f]{6}$/i.test(datos.color || "") ? datos.color.toLowerCase() : "#1f2937";

  return {
    id,
    tipo: "caja",
    texto: datos.texto,
    x,
    y,
    ancho: limitar(ancho, CAJA_ANCHO_MINIMO, 10000),
    fuente,
    tamaño: Math.round(limitar(tamano, 12, 72)),
    negrita: Boolean(datos.negrita),
    cursiva: Boolean(datos.cursiva),
    color,
  };
}

function aplicarEstiloCaja(registro) {
  const { datos, el } = registro;
  el.style.left = `${datos.x}px`;
  el.style.top = `${datos.y}px`;
  el.style.width = `${datos.ancho}px`;
  el.style.color = datos.color;
  el.style.fontFamily = datos.fuente;
  el.style.fontSize = `${datos.tamaño}px`;
  el.style.fontWeight = datos.negrita ? "700" : "400";
  el.style.fontStyle = datos.cursiva ? "italic" : "normal";
}

function colocarCaretAlFinal(elemento) {
  const rango = document.createRange();
  rango.selectNodeContents(elemento);
  rango.collapse(false);
  const seleccion = window.getSelection();
  seleccion.removeAllRanges();
  seleccion.addRange(rango);
}

function sincronizarControlesCaja() {
  if (!cajaSeleccionada) return;
  const datos = cajaSeleccionada.datos;
  textFontInput.value = datos.fuente;
  textSizeInput.value = String(datos.tamaño);
  textColorInput.value = datos.color;
  textBoldButton.setAttribute("aria-pressed", String(datos.negrita));
  textItalicButton.setAttribute("aria-pressed", String(datos.cursiva));
  textBoldButton.classList.toggle("active", datos.negrita);
  textItalicButton.classList.toggle("active", datos.cursiva);
}

function actualizarBarraFormato() {
  const mostrar = Boolean(cajaSeleccionada) && puedeDibujar && currentTool === "text";
  textFormatControls.hidden = !mostrar;
  if (mostrar) sincronizarControlesCaja();
}

function seleccionarCaja(registro) {
  if (!puedeDibujar || currentTool !== "text") return;
  if (cajaSeleccionada && cajaSeleccionada !== registro) {
    cajaSeleccionada.el.classList.remove("selected");
  }
  cajaSeleccionada = registro;
  registro.el.classList.add("selected");
  actualizarBarraFormato();
}

function deseleccionarCaja() {
  if (cajaSeleccionada) cajaSeleccionada.el.classList.remove("selected");
  cajaSeleccionada = null;
  actualizarBarraFormato();
}

function cancelarGuardadoCaja(id) {
  const timer = guardadosPendientes.get(id);
  if (!timer) return;
  clearTimeout(timer);
  guardadosPendientes.delete(id);
}

function guardarCaja(registro) {
  cancelarGuardadoCaja(registro.datos.id);
  if (!puedeDibujar || !registro.datos.texto.trim()) return;
  if (!socket?.connected) {
    informar("No hay conexión; la caja de texto no se guardó.");
    return;
  }
  socket.emit("pizarron:caja", registro.datos, (respuesta) => {
    if (respuesta?.ok) return;
    informar(respuesta?.mensaje || "No se pudo guardar la caja de texto.");
  });
}

function programarGuardadoCaja(registro, retraso = 450) {
  cancelarGuardadoCaja(registro.datos.id);
  const id = registro.datos.id;
  const timer = window.setTimeout(() => {
    guardadosPendientes.delete(id);
    guardarCaja(registro);
  }, retraso);
  guardadosPendientes.set(id, timer);
}

function enviarBorradoCaja(id) {
  if (!puedeDibujar) return;
  if (!socket?.connected) {
    informar("No hay conexión; la caja no se borró del pizarrón.");
    return;
  }
  socket.emit("pizarron:caja-borrar", { id }, (respuesta) => {
    if (respuesta?.ok) return;
    informar(respuesta?.mensaje || "No se pudo borrar la caja de texto.");
  });
}

function quitarCajaLocal(id) {
  const registro = cajas.get(id);
  if (!registro) return;
  cancelarGuardadoCaja(id);
  cajas.delete(id);
  registro.el.remove();
  if (cajaSeleccionada === registro) deseleccionarCaja();
}

function eliminarCaja(registro) {
  const { id } = registro.datos;
  quitarCajaLocal(id);
  // Se envía siempre: si el guardado estaba en vuelo, el borrado debe
  // llegar al servidor después para no dejar una caja huérfana.
  enviarBorradoCaja(id);
}

function iniciarArrastreCaja(event, registro) {
  if (!puedeDibujar || currentTool !== "text") return;
  event.preventDefault();
  event.stopPropagation();
  seleccionarCaja(registro);

  const tirador = event.currentTarget;
  const pointerId = event.pointerId;
  const inicio = {
    clientX: event.clientX,
    clientY: event.clientY,
    x: registro.datos.x,
    y: registro.datos.y,
  };
  const { width, height } = obtenerTamanoTablero();

  tirador.setPointerCapture(pointerId);

  const mover = (movimiento) => {
    const maxX = Math.max(0, width - registro.datos.ancho);
    const maxY = Math.max(0, height - 40);
    registro.datos.x = Math.round(
      limitar(inicio.x + movimiento.clientX - inicio.clientX, 0, maxX)
    );
    registro.datos.y = Math.round(
      limitar(inicio.y + movimiento.clientY - inicio.clientY, 0, maxY)
    );
    aplicarEstiloCaja(registro);
  };

  const terminar = () => {
    tirador.removeEventListener("pointermove", mover);
    tirador.removeEventListener("pointerup", terminar);
    tirador.removeEventListener("pointercancel", terminar);
    if (tirador.hasPointerCapture?.(pointerId)) {
      try {
        tirador.releasePointerCapture(pointerId);
      } catch {
        // El navegador ya liberó la captura.
      }
    }
    if (registro.datos.texto.trim()) guardarCaja(registro);
  };

  tirador.addEventListener("pointermove", mover);
  tirador.addEventListener("pointerup", terminar);
  tirador.addEventListener("pointercancel", terminar);
}

function iniciarRedimensionCaja(event, registro) {
  if (!puedeDibujar || currentTool !== "text") return;
  event.preventDefault();
  event.stopPropagation();
  seleccionarCaja(registro);

  const tirador = event.currentTarget;
  const pointerId = event.pointerId;
  const clientXInicial = event.clientX;
  const anchoInicial = registro.datos.ancho;
  const { width } = obtenerTamanoTablero();
  const anchoMaximo = Math.max(CAJA_ANCHO_MINIMO, width - registro.datos.x);

  tirador.setPointerCapture(pointerId);

  const mover = (movimiento) => {
    const ancho = anchoInicial + movimiento.clientX - clientXInicial;
    registro.datos.ancho = Math.round(
      limitar(ancho, CAJA_ANCHO_MINIMO, anchoMaximo)
    );
    aplicarEstiloCaja(registro);
  };

  const terminar = () => {
    tirador.removeEventListener("pointermove", mover);
    tirador.removeEventListener("pointerup", terminar);
    tirador.removeEventListener("pointercancel", terminar);
    if (tirador.hasPointerCapture?.(pointerId)) {
      try {
        tirador.releasePointerCapture(pointerId);
      } catch {
        // El navegador ya liberó la captura.
      }
    }
    if (registro.datos.texto.trim()) guardarCaja(registro);
  };

  tirador.addEventListener("pointermove", mover);
  tirador.addEventListener("pointerup", terminar);
  tirador.addEventListener("pointercancel", terminar);
}

function renderizarCaja(datos) {
  const el = document.createElement("div");
  el.className = "text-box";
  el.dataset.id = datos.id;

  const content = document.createElement("div");
  content.className = "text-box-content";
  content.textContent = datos.texto;
  content.spellcheck = false;
  content.contentEditable = String(puedeDibujar);
  content.setAttribute("role", "textbox");
  content.setAttribute("aria-multiline", "true");
  content.setAttribute("aria-label", "Texto del pizarrón");

  const mover = document.createElement("span");
  mover.className = "text-box-mover";
  mover.title = "Mover caja";
  mover.setAttribute("aria-hidden", "true");

  const redimensionar = document.createElement("span");
  redimensionar.className = "text-box-resizer";
  redimensionar.title = "Cambiar ancho";
  redimensionar.setAttribute("aria-hidden", "true");

  el.append(content, mover, redimensionar);
  textBoxLayer.appendChild(el);

  const registro = { datos, el, content };

  el.addEventListener("pointerdown", (event) => {
    if (!puedeDibujar || currentTool !== "text") return;
    if (event.target === mover || event.target === redimensionar) return;
    seleccionarCaja(registro);
  });

  content.addEventListener("input", () => {
    if (!puedeDibujar) return;
    let texto = content.innerText.replace(/\r/g, "");
    if (texto.length > CAJA_TEXTO_MAXIMO) {
      texto = texto.slice(0, CAJA_TEXTO_MAXIMO);
      content.innerText = texto;
      colocarCaretAlFinal(content);
    }
    registro.datos.texto = texto;
    if (texto.trim()) {
      programarGuardadoCaja(registro);
    } else {
      cancelarGuardadoCaja(datos.id);
    }
  });

  content.addEventListener("blur", () => {
    if (!puedeDibujar || !cajas.has(datos.id)) return;
    if (!registro.datos.texto.trim()) {
      // Al crearla, el clic en el canvas puede robarle el foco un instante
      // antes de que se reafirme; no se borra hasta comprobar el estado.
      if (registro.recienCreada) {
        window.setTimeout(() => {
          if (!cajas.has(datos.id)) return;
          if (registro.datos.texto.trim()) return;
          if (document.activeElement === registro.content) return;
          eliminarCaja(registro);
        }, 250);
        return;
      }
      eliminarCaja(registro);
      return;
    }
    guardarCaja(registro);
  });

  content.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      content.blur();
    }
  });

  mover.addEventListener("pointerdown", (event) => iniciarArrastreCaja(event, registro));
  redimensionar.addEventListener("pointerdown", (event) =>
    iniciarRedimensionCaja(event, registro)
  );

  cajas.set(datos.id, registro);
  aplicarEstiloCaja(registro);
  return registro;
}

function crearCajaEn(x, y) {
  if (!puedeDibujar) return;
  const { width, height } = obtenerTamanoTablero();
  const ancho = Math.min(320, Math.max(CAJA_ANCHO_MINIMO, width - 20));
  const tamano = limitar(Math.round(Number(textSizeInput.value) || 24), 12, 72);
  const datos = {
    id: generarId(),
    tipo: "caja",
    texto: "",
    x: Math.round(limitar(x, 0, Math.max(0, width - ancho))),
    y: Math.round(limitar(y, 0, Math.max(0, height - 60))),
    ancho: Math.round(ancho),
    fuente: FUENTES_CAJA.has(textFontInput.value) ? textFontInput.value : "Arial",
    tamaño: tamano,
    negrita: textBoldButton.getAttribute("aria-pressed") === "true",
    cursiva: textItalicButton.getAttribute("aria-pressed") === "true",
    color: /^#[0-9a-f]{6}$/i.test(currentColor) ? currentColor : "#1f2937",
  };

  const registro = renderizarCaja(datos);
  registro.recienCreada = true;
  const enfocar = () => {
    if (!cajas.has(datos.id) || !puedeDibujar || currentTool !== "text") return false;
    seleccionarCaja(registro);
    registro.content.focus();
    colocarCaretAlFinal(registro.content);
    return document.activeElement === registro.content;
  };

  enfocar();
  // El clic sobre el canvas puede devolver el foco al documento después
  // del pointerdown; se reafirma en el siguiente turno. Hasta entonces
  // la caja vacía no se elimina por ese blur transitorio.
  window.setTimeout(() => {
    enfocar();
    registro.recienCreada = false;
  }, 0);
}

function aplicarFormatoCaja(cambios) {
  if (!cajaSeleccionada || !puedeDibujar) return;
  Object.assign(cajaSeleccionada.datos, cambios);
  aplicarEstiloCaja(cajaSeleccionada);
  sincronizarControlesCaja();
  if (cajaSeleccionada.datos.texto.trim()) programarGuardadoCaja(cajaSeleccionada);
}

function aplicarTrazo(evento) {
  const id = evento?.id;
  if (id && idsTrazos.has(id)) return;
  const datos = parsearDatos(evento);
  if (!datos || datos.tipo === "caja" || datos.tipo === "texto") return;
  const trazo = normalizarTrazo(datos);
  if (!trazo) return;
  if (id) idsTrazos.add(id);
  strokes.push(trazo);
  redrawStrokes();
}

function aplicarElementoCargado(evento) {
  const id = evento?.id;
  const datos = parsearDatos(evento);
  if (!datos) return;

  if (datos.tipo === "caja" || datos.tipo === "texto") {
    if (id && cajas.has(id)) return;
    const caja = normalizarCaja({ ...datos, id: datos.id || id }, id);
    if (caja && !cajas.has(caja.id)) renderizarCaja(caja);
    return;
  }

  aplicarTrazo(evento);
}

function aplicarCajaRemota(payload) {
  const datos = parsearDatos(payload);
  if (!datos) return;
  const id = datos.id || payload?.id;
  const caja = normalizarCaja({ ...datos, id }, id);
  if (!caja) return;

  const registro = cajas.get(caja.id);
  if (!registro) {
    renderizarCaja(caja);
    return;
  }

  const estabaEditando = document.activeElement === registro.content;
  registro.datos = caja;
  aplicarEstiloCaja(registro);
  if (!estabaEditando) registro.content.textContent = caja.texto;
  if (cajaSeleccionada === registro) sincronizarControlesCaja();
}

function aplicarEventoPendiente(evento) {
  if (evento.tipo === "limpiar") {
    limpiarPizarron();
    return;
  }
  if (evento.tipo === "caja") {
    aplicarCajaRemota(evento.payload);
    return;
  }
  if (evento.tipo === "caja-borrar") {
    quitarCajaLocal(evento.payload?.id);
    return;
  }
  aplicarTrazo(evento.payload);
}

function iniciarDibujo(event) {
  if (!puedeDibujar) return;
  if (currentTool === "text") {
    // Evita que el foco por defecto del clic en el canvas se lleve el
    // cursor de la caja recién creada.
    event.preventDefault();
    const pos = getPointerPosition(event);
    try {
      crearCajaEn(pos.x, pos.y);
    } catch (error) {
      console.error("No se pudo crear la caja de texto:", error);
    }
    return;
  }

  if (currentTool === "pen" || currentTool === "eraser") {
    drawing = true;
    currentPath = [getPointerPosition(event)];
    canvas.setPointerCapture(event.pointerId);
  }
}

function enviarTrazo(trazo, alFallar) {
  if (!puedeDibujar || !socket?.connected) {
    informar("No hay conexión; el cambio no se guardó.");
    if (typeof alFallar === "function") alFallar();
    return;
  }
  socket.emit("pizarron:trazo", trazo, (respuesta) => {
    if (respuesta?.ok) return;
    informar(respuesta?.mensaje || "No se pudo guardar el cambio.");
    if (typeof alFallar === "function") alFallar();
  });
}

function dibujar(event) {
  if (!drawing || !puedeDibujar) return;

  const pos = getPointerPosition(event);
  const previousPoint = currentPath[currentPath.length - 1];
  if (!previousPoint) return;
  currentPath.push(pos);

  const esBorrador = currentTool === "eraser";
  const trazo = {
    tipo: "trazo",
    herramienta: esBorrador ? "borrador" : "lapiz",
    points: [previousPoint, pos],
    color: esBorrador ? "#ffffff" : currentColor,
    width: esBorrador ? 24 : currentWidth,
  };

  // El servidor no reenvía el trazo a quien lo emitió, así que se pinta
  // de inmediato en local y, si falla el guardado, se retira.
  strokes.push(trazo);
  redrawStrokes();
  enviarTrazo(trazo, () => {
    const indice = strokes.lastIndexOf(trazo);
    if (indice !== -1) strokes.splice(indice, 1);
    redrawStrokes();
  });
}

function finalizarDibujo() {
  if (!drawing) return;
  drawing = false;
  currentPath = [];
}

if (socket) {
  socket.on("connect", () => {
    cargaRecibida = false;
    eventosPendientes = [];
    informar("Conectado; cargando el pizarrón…");
    if (grupoId) {
      socket.emit("unirse-pizarron", { grupo_id: grupoId, materia_id: materiaId });
    } else {
      informar("Falta indicar el curso del pizarrón.");
    }
  });

  socket.on("pizarron:carga", (datos) => {
    limpiarPizarron();
    (datos?.trazos || []).forEach(aplicarElementoCargado);
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

  socket.on("pizarron:caja", (payload) => {
    if (!cargaRecibida) {
      eventosPendientes.push({ tipo: "caja", payload });
      return;
    }
    aplicarCajaRemota(payload);
  });

  socket.on("pizarron:caja-borrar", (payload) => {
    if (!cargaRecibida) {
      eventosPendientes.push({ tipo: "caja-borrar", payload });
      return;
    }
    quitarCajaLocal(payload?.id);
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

textFontInput.addEventListener("change", (event) => {
  const fuente = FUENTES_CAJA.has(event.target.value) ? event.target.value : "Arial";
  aplicarFormatoCaja({ fuente });
});

textSizeInput.addEventListener("change", () => {
  const tamano = limitar(Math.round(Number(textSizeInput.value) || 24), 12, 72);
  textSizeInput.value = String(tamano);
  aplicarFormatoCaja({ tamaño: tamano });
});

textBoldButton.addEventListener("click", () => {
  if (!cajaSeleccionada) return;
  aplicarFormatoCaja({ negrita: !cajaSeleccionada.datos.negrita });
});

textItalicButton.addEventListener("click", () => {
  if (!cajaSeleccionada) return;
  aplicarFormatoCaja({ cursiva: !cajaSeleccionada.datos.cursiva });
});

textColorInput.addEventListener("input", (event) => {
  aplicarFormatoCaja({ color: event.target.value });
});

deleteTextBoxButton.addEventListener("click", () => {
  if (!cajaSeleccionada) return;
  eliminarCaja(cajaSeleccionada);
  informar("Caja de texto borrada.");
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveTool(button.dataset.tool));
});

function estaEditandoTexto(event) {
  const target = event.target;
  return Boolean(
    target?.closest?.('input, select, textarea, [contenteditable="true"]')
      || target?.isContentEditable
  );
}

document.addEventListener("keydown", (event) => {
  if (!puedeDibujar) return;
  if (estaEditandoTexto(event)) return;

  if (event.key === "Escape" && cajaSeleccionada) {
    deseleccionarCaja();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && cajaSeleccionada) {
    event.preventDefault();
    eliminarCaja(cajaSeleccionada);
    informar("Caja de texto borrada.");
    return;
  }
  if (event.key.toLowerCase() === "p") setActiveTool("pen");
  if (event.key.toLowerCase() === "b") setActiveTool("eraser");
  if (event.key.toLowerCase() === "t") setActiveTool("text");
});

// En modo solo lectura no se permite menú contextual ni arrastre de imágenes.
document.addEventListener("contextmenu", (event) => {
  if (!puedeDibujar) event.preventDefault();
});
document.addEventListener("dragstart", (event) => {
  if (!puedeDibujar) event.preventDefault();
});
actualizarPermisos(false);
window.addEventListener("resize", resizeCanvas);
window.addEventListener("load", resizeCanvas);
