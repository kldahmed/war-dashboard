'use strict';

const candidates = [
  'https://live.alarabiya.net/alarabiapublish/alarabiya.smil/playlist.m3u8',
  'https://av.alarabiya.net/alarabiapublish/alarabiya.smil/playlist.m3u8',
  'https://shls-live-enc.edgenextcdn.net/out/v1/45ad6fbe1f7149ad9f05f8aefc38f6c0/index.m3u8',
  'https://hms.pfs.gdn/v1/broadcast/mtv/playlist.m3u8',
  'https://svs.itworkscdn.net/rudawlive/rudawlive.smil/playlist.m3u8',
];

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'war-dashboard-probe/1.0',
        'Accept': 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
      },
    });
    const body = await r.text();
    return {
      url,
      ok: r.ok,
      status: r.status,
      type: r.headers.get('content-type') || '',
      hasExtM3u: body.includes('#EXTM3U'),
      head: body.slice(0, 100).replace(/\s+/g, ' '),
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      type: '',
      hasExtM3u: false,
      error: String(error.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const rows = [];
  for (const url of candidates) {
    rows.push(await probe(url));
  }
  console.log(JSON.stringify(rows, null, 2));
})();
