// puppeteer_kakao_quick_test.js
const puppeteer = require('puppeteer');
const fs = require('fs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  // 1) 브라우저 / 페이지 열기
  const browser = await puppeteer.launch({ headless: true });
  const page    = await browser.newPage();

  // 2) 페이지 이동 (첫 화면만 가져옴)
  await page.goto(
    // 'https://page.kakao.com/landing/genre/11/86',
    // 'https://page.kakao.com/landing/genre/11/120',
    // 'https://page.kakao.com/landing/genre/11/89',
    // 'https://page.kakao.com/landing/genre/11/117',
    // 'https://page.kakao.com/landing/genre/11/87',
    // 'https://page.kakao.com/landing/genre/11/123',
    'https://page.kakao.com/landing/genre/11/125',
    { waitUntil: 'networkidle2' }
  );

  // 무한 스크롤
  let prevHeight;
  try {
    while (true) {
      prevHeight = await page.evaluate('document.body.scrollHeight');
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await sleep(500);
      const newHeight = await page.evaluate('document.body.scrollHeight');
      if (newHeight === prevHeight) break;
    }
  } catch (e) {
    console.error('스크롤 중 오류:', e);
  }

  // 브라우저 컨텍스트에서 실행될 함수
  const hrefs = await page.evaluate(() => {
    const selector = 'a.cursor-pointer:not(:has(img[alt="19세"]))';
    // const selector = 'a.cursor-pointer:has(img[alt="새 회차 뱃지"])';
    const anchors = document.querySelectorAll(selector);
    return Array.from(anchors).map(anchor => anchor.href);
  });

  console.log(hrefs.length);
  fs.writeFileSync('7.json', JSON.stringify(hrefs, null, 4));

  await browser.close();
})();
