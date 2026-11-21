// Clique no ícone da extensão abre o painel lateral.
chrome.runtime.onInstalled.addListener(function () {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
});
chrome.runtime.onStartup.addListener(function () {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
});

// Robô de check-in automático (Azul): ver checkin-robo.js
importScripts('checkin-robo.js');
