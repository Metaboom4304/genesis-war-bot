let simulationMode = true;

function toggleSimulationMode() {
  simulationMode = !simulationMode;
  return simulationMode;
}

function getSimulationMode() {
  return simulationMode;
}

// 📨 Черновик сообщения
let broadcastDraft = '';
let broadcastStyle = 'default';

function setBroadcastText(text) {
  broadcastDraft = text;
}

function getBroadcastText() {
  return broadcastDraft;
}

function clearBroadcastText() {
  broadcastDraft = '';
}

function setBroadcastStyle(style) {
  broadcastStyle = style;
}

function getBroadcastStyle() {
  return broadcastStyle;
}

module.exports = {
  toggleSimulationMode,
  getSimulationMode,
  setBroadcastText,
  getBroadcastText,
  clearBroadcastText,
  setBroadcastStyle,
  getBroadcastStyle
};
