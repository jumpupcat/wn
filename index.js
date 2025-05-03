// puppeteer_scraper_kakao_debug.js

const puppeteer = require('puppeteer');
const fs = require('fs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page    = await browser.newPage();
  await page.goto('https://page.kakao.com/landing/genre/11', { waitUntil: 'networkidle2' });

  // 무한 스크롤
  let prevHeight;
  try {
    while (true) {
      prevHeight = await page.evaluate('document.body.scrollHeight');
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await sleep(1500);
      const newHeight = await page.evaluate('document.body.scrollHeight');
      if (newHeight === prevHeight) break;
    }
  } catch (e) {
    console.error('스크롤 중 오류:', e);
  }

  // --- debug: 페이지 내 모든 li 요소 개수 찍어보기 ---
  const allLiCount = await page.evaluate(() => document.querySelectorAll('li').length);
  console.log(`▶ 전체 <li> 요소 개수: ${allLiCount}`);

  // --- debug: 우리가 쓰고 있는 셀렉터로 찾아지는 요소 개수 ---
  const cardCount = await page.evaluate(() => document.querySelectorAll('ul.list-card > li').length);
  console.log(`▶ ul.list-card > li 개수: ${cardCount}`);

  // --- 실제 수집 시도 (셀렉터가 맞다면 items.length > 0 여야 함) ---
  const items = await page.$$eval('ul.list-card > li > a', els =>
    els.map(el => ({
      title: el.querySelector('.title')?.innerText.trim() || '(no title)',
      link:  el.href.startsWith('http') ? el.href : 'https://page.kakao.com'+el.getAttribute('href'),
    }))
  );
  console.log(`▶ 수집된 작품 수: ${items.length}`);
  console.log(items.slice(0,5));  // 앞의 5개만 예시 출력

  await browser.close();
})();
