// ==UserScript==
// @name         Kurisute Font Bundle Replacer
// @namespace    local.font-replacer
// @version      1.2.0
// @description  フォントバンドルのダウンロード先を差し替え版に向ける
// @match        https://d1yl2keu90rg3.cloudfront.net/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // 差し替え対象のファイル名 (URL のクエリや前方のパスは問わない)
  // 2026-11-06 のアップデートで YooAsset のファイル名が BundleName 形式から
  // HashName 形式 (ファイル内容の MD5) に変わった。フォントバンドルが更新されると
  // ハッシュも変わるため、その際はここに新しいハッシュを追加する。
  const TARGETS = [
    /^defaultpackage_assets_localresources_font[^/?#]*\.bundle$/,
    /^6ffb33238a4ee4fa5e85fff93468dd67\.bundle$/,
  ];
  // 差し替え版バンドルの配置先 (CORS 許可されたホストに置くこと)
  // github.com/.../raw/... はリダイレクト応答に CORS ヘッダが無いため raw.githubusercontent.com を直接指す
  const REPLACEMENT_URL = 'https://raw.githubusercontent.com/chira2chira/kurisute-font/refs/heads/master/defaultpackage_assets_localresources_font.bundle';

  const rewrite = (url) => {
    const s = String(url);
    const name = s.split(/[?#]/)[0].split('/').pop() || '';
    if (!TARGETS.some((re) => re.test(name))) return url;
    console.log('[FontReplacer]', location.href, ':', s, '->', REPLACEMENT_URL);
    return REPLACEMENT_URL;
  };

  // raw.githubusercontent.com は CORS プリフライト (OPTIONS) に 403 を返すため、
  // 差し替えたリクエストは「単純リクエスト」(GET + CORS セーフリストのヘッダのみ) にする。
  // ゲーム側が付けるカスタムヘッダ (If-None-Match 等も含む) はここで落とす。
  const SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'range']);
  const isSafeHeader = (name, value) => {
    const n = String(name).toLowerCase();
    if (!SAFE_HEADERS.has(n)) return false;
    // Range は単一範囲 (bytes=N- / bytes=N-M) のみセーフリスト
    if (n === 'range') return /^bytes=\d+-\d*$/.test(String(value).trim());
    return true;
  };
  const dropped = (name, value) => console.log('[FontReplacer] drop header:', name, '=', value);

  const toSimpleInit = (headersLike, init) => {
    const headers = new Headers();
    new Headers(headersLike || undefined).forEach((value, name) => {
      if (isSafeHeader(name, value)) headers.set(name, value);
      else dropped(name, value);
    });
    return { ...init, method: 'GET', headers, body: undefined, credentials: 'omit', mode: 'cors' };
  };

  // fetch
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const srcUrl = input instanceof Request ? input.url : String(input);
    const url = rewrite(srcUrl);
    if (url === srcUrl) return origFetch.call(this, input, init);
    const headers = (init && init.headers) || (input instanceof Request ? input.headers : undefined);
    const base = input instanceof Request ? { cache: input.cache, signal: input.signal } : {};
    return origFetch.call(this, url, toSimpleInit(headers, { ...base, ...init }));
  };

  // XMLHttpRequest (UnityWebRequest は XHR を使う)
  const rewritten = new WeakSet();
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const newUrl = rewrite(url);
    if (newUrl === url) {
      rewritten.delete(this);
      return origOpen.call(this, method, url, ...rest);
    }
    rewritten.add(this);
    return origOpen.call(this, 'GET', newUrl, ...rest);
  };
  const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (rewritten.has(this) && !isSafeHeader(name, value)) return dropped(name, value);
    return origSetRequestHeader.call(this, name, value);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (rewritten.has(this)) {
      // 資格情報付きだと ACAO: * が拒否されるため外す
      this.withCredentials = false;
      return origSend.call(this);
    }
    return origSend.call(this, body);
  };
})();
