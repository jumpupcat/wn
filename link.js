// puppeteer_kakao_quick_test_v6_simplified.js
const puppeteer = require('puppeteer');
const Database = require('better-sqlite3');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- 선택자 정의 ---
const SCROLL_CONTROL_SELECTOR = 'a.cursor-pointer:has(img[alt="새 회차 뱃지"])'; // 스크롤 제어용
const EXTRACTION_SELECTOR = 'a.cursor-pointer:not(:has(img[alt="19세"]))';      // 최종 추출용
// --------------------

const MAX_STABLE_SCROLL_ATTEMPTS = 3; // 높이 안정성 Fallback 횟수

async function getElementCount(page, selector) {
  try {
    await sleep(100);
    return await page.evaluate((sel) => {
      return document.querySelectorAll(sel).length;
    }, selector);
  } catch (e) {
    console.error(`getElementCount (${selector}) 오류: ${e.message}`);
    return -1;
  }
}

(async () => {
  console.log('브라우저를 실행합니다...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const targetUrl = 'https://page.kakao.com/landing/genre/11';
  console.log(`페이지로 이동합니다: ${targetUrl}`);
  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('페이지 로딩 완료.');
  } catch (e) {
    console.error("페이지 이동/로딩 오류:", e.message);
    await browser.close();
    return;
  }

  let previousScrollCtrlCount = -1;
  let currentScrollCtrlCount = 0;
  // stableCountChecks 제거됨

  let stableScrollAttempts = 0;
  let lastKnownHeight = 0;
  let loopError = null;

  console.log(`스크롤을 시작합니다. '${SCROLL_CONTROL_SELECTOR}' 기준 개수가 안정되면 마지막 스크롤 후 종료.`);

  try {
    while (true) {
      lastKnownHeight = await page.evaluate('document.body.scrollHeight');
      // --- Scroll & Wait ---
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await sleep(1200); // 일반 스크롤 시 대기 시간

      // --- Get Count (Scroll Control) ---
      currentScrollCtrlCount = await getElementCount(page, SCROLL_CONTROL_SELECTOR);
      if (previousScrollCtrlCount === -1) { console.log(`초기 '${SCROLL_CONTROL_SELECTOR}' 개수: ${currentScrollCtrlCount}`); }

      if (currentScrollCtrlCount === -1) {
        console.log("스크롤 제어용 요소 개수 확인 중 오류 발생. 스크롤 중단.");
        currentScrollCtrlCount = previousScrollCtrlCount > 0 ? previousScrollCtrlCount : 0;
        loopError = new Error("GetElementCount failed"); // 오류 상태 기록
        break;
      }

      // --- Simplified Stability Check ---
      if (previousScrollCtrlCount !== -1) { // 첫 루프는 건너뜀
        if (currentScrollCtrlCount > previousScrollCtrlCount) {
          console.log(`'${SCROLL_CONTROL_SELECTOR}' 개수 증가: ${previousScrollCtrlCount} -> ${currentScrollCtrlCount}.`);
        } else if (currentScrollCtrlCount === previousScrollCtrlCount) {
          // 개수 변화 없음 -> 마지막 스크롤/대기 후 종료
          console.log(`'${SCROLL_CONTROL_SELECTOR}' 개수 변화 없음 (${currentScrollCtrlCount}). 마지막 스크롤 및 대기 실행 후 종료합니다.`);
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)'); // 마지막 스크롤
          await sleep(2000); // 마지막 대기 (충분히 길게)
          console.log('최종 스크롤 및 대기 완료. 루프 종료.');
          break; // 루프 탈출
        } else {
          console.warn(`경고: '${SCROLL_CONTROL_SELECTOR}' 개수 감소 (${previousScrollCtrlCount} -> ${currentScrollCtrlCount}).`);
        }
      }
      // 다음 비교를 위해 현재 카운트를 이전 카운트로 업데이트
      previousScrollCtrlCount = currentScrollCtrlCount;

      // --- Check Height Stability (Fallback) ---
      const newHeight = await page.evaluate('document.body.scrollHeight');
      if (newHeight === lastKnownHeight) {
        stableScrollAttempts++;
        if (stableScrollAttempts >= MAX_STABLE_SCROLL_ATTEMPTS) {
          console.log(`스크롤 높이가 ${MAX_STABLE_SCROLL_ATTEMPTS}번 연속 변하지 않아 루프 종료 (페이지 끝 도달 추정).`);
          // 높이 안정 시에도 최종 대기 추가 (일관성)
          console.log('페이지 끝 도달 추정. 최종 대기 실행 중...');
          await sleep(2000);
          console.log('최종 대기 완료.');
          break;
        }
      } else {
        stableScrollAttempts = 0;
      }
    } // End while loop
  } catch (e) {
      console.error('스크롤 또는 요소 개수 확인 중 주 루프에서 오류 발생:', e);
      loopError = e; // 오류 기록
      // 오류 발생 시 스크롤 제어 카운트 복구 시도
      currentScrollCtrlCount = currentScrollCtrlCount > 0 ? currentScrollCtrlCount : (previousScrollCtrlCount > 0 ? previousScrollCtrlCount : 0);
      console.log(`오류 발생. '${SCROLL_CONTROL_SELECTOR}' 기준 확인된 마지막 요소 수: ${currentScrollCtrlCount}`);
  }

  // 루프 후 최종 스크롤/대기 블록 제거됨

  // --- 최종 링크 추출 (EXTRACTION_SELECTOR 사용) ---
  console.log(`스크롤 종료. '${EXTRACTION_SELECTOR}' 기준으로 링크 추출 시도...`);
  let hrefs = [];
  if (!loopError) { // 루프 중 심각한 오류가 없었을 경우에만 추출 시도
      try {
          hrefs = await page.evaluate((anchorSelector) => {
              const results = [];
              const anchors = document.querySelectorAll(anchorSelector);

              Array.from(anchors).forEach(anchor => {
                  const href = anchor.href;

                  if (href === 'https://www.ftc.go.kr/bizCommPop.do?wrkr_no=2208802594') {
                      return; 
                  }

                  const titleWrapper = anchor.querySelector('div.jsx-2792908821.w-full.space-y-4pxr.pb-4pxr.pr-8pxr.pt-8pxr.h-76pxr'); // 제목을 포함하는 wrapper div
                  if (titleWrapper) {
                      const titleElement = titleWrapper.querySelector('div.font-small1.line-clamp-2.break-all.text-el-60');
                      if (titleElement) {
                          const title = titleElement.innerText.trim();

                          if (title && !title.includes("단행")) {
                              results.push(href);
                          }
                      }
                  }
              });

              return results;
          }, EXTRACTION_SELECTOR);

          console.log(`'${EXTRACTION_SELECTOR}' 기준으로 ${hrefs.length}개의 링크를 성공적으로 추출했습니다.`);

      } catch (evalError) {
          console.error("링크 추출 중 페이지 evaluate 오류:", evalError);
      }
  } else {
      console.log("루프 중 오류가 발생하여 추출을 건너<0xEB><0x81>니다.");
  }
  // ---------------------------------------------

  // const idString = targetUrl.split('/').pop();
  const dbFilePath = path.resolve(__dirname, 'kakaopage.db'); // DB 파일명 변경
  const db = new Database(dbFilePath);
  const stmt = db.prepare(`
    INSERT INTO contents (id, re)
    VALUES (@id, 1)
    ON CONFLICT(id) DO UPDATE SET re = 1
  `);
  
  db.exec('BEGIN');

  for(const href of hrefs) {
    stmt.run({ id: href.split('/').pop() });
  }

  db.exec('COMMIT');
  db.close();

  // 5) 브라우저 닫기
  console.log('브라우저를 닫습니다.');
  await browser.close();
})();