(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function fmt(iso) { return iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'; }
  function carregar() {
    chrome.storage.local.get(['roboChave', 'roboAtivo', 'roboLog', 'roboUltimaRodada', 'roboFila']).then(function (s) {
      $('chave').value = s.roboChave || '';
      $('ativo').checked = s.roboAtivo !== false;
      $('sit').innerHTML = (s.roboChave ? '<span class="ok">Chave salva.</span>' : '<span class="erro">Falta a chave.</span>') +
        ' Última conferência: ' + fmt(s.roboUltimaRodada) + (s.roboFila != null ? ' · ' + s.roboFila + ' na fila' : '');
      $('log').innerHTML = (s.roboLog || []).slice(0, 25).map(function (l) {
        return '<li><small>' + fmt(l.em) + '</small> — ' + String(l.txt).replace(/[<>&]/g, '') + '</li>';
      }).join('') || '<li><small>nada ainda</small></li>';
    });
  }
  $('salvar').onclick = function () {
    var chave = $('chave').value.trim();
    if (chave && !/^robo_[\w-]{20,}$/.test(chave)) { $('msg').innerHTML = '<span class="erro">A chave deve começar com robo_.</span>'; return; }
    chrome.storage.local.set({ roboChave: chave, roboAtivo: $('ativo').checked }).then(function () {
      $('msg').innerHTML = '<span class="ok">Salvo.</span>'; carregar();
    });
  };
  $('rodar').onclick = function () {
    $('msg').textContent = 'Conferindo…';
    chrome.runtime.sendMessage({ tipo: 'robo-rodar-agora' }, function (r) {
      $('msg').innerHTML = r && r.ok ? '<span class="ok">Fila: ' + r.fila + ' · processados agora: ' + r.processados + '</span>'
        : '<span class="erro">' + ((r && r.erro) || 'sem resposta') + '</span>';
      carregar();
    });
  };
  carregar();
})();
