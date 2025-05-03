// scrapeKakao_with_sqlite_dateformat.js
const puppeteer = require('puppeteer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// --- 데이터 변환 헬퍼 함수 ---
function parseViews(viewsText) {
    if (!viewsText || typeof viewsText !== 'string') return null;
    try {
        let numStr = viewsText.replace(/,/g, '');
        let multiplier = 1;
        if (numStr.includes('억')) { multiplier = 100000000; numStr = numStr.replace(/억/g, '').trim(); }
        else if (numStr.includes('만')) { multiplier = 10000; numStr = numStr.replace(/만/g, '').trim(); }
        const num = parseFloat(numStr);
        return isNaN(num) ? null : Math.round(num * multiplier);
    } catch (e) { console.error(`Error parsing views "${viewsText}":`, e); return null; }
}
function parseRating(ratingText) {
    if (!ratingText || typeof ratingText !== 'string') return null;
    try {
        const num = parseFloat(ratingText);
        return isNaN(num) ? null : Math.round(num / 2);
    } catch (e) { console.error(`Error parsing rating "${ratingText}":`, e); return null; }
}

// **날짜 문자열 변환 함수 추가 ("YY.MM.DD" -> "YYYY-MM-DD")**
function formatDateString(rawDateStr) {
    if (!rawDateStr || typeof rawDateStr !== 'string') return null;
    const match = rawDateStr.match(/^(\d{2})\.(\d{2})\.(\d{2})$/); // YY.MM.DD 형식 확인
    if (match) {
        const yearYY = parseInt(match[1], 10);
        const month = match[2]; // MM
        const day = match[3];   // DD
        // 2000년대 년도로 가정 (카카오페이지 콘텐츠 등록일에 적합)
        const yearYYYY = 2000 + yearYY; 
        return `${yearYYYY}-${month}-${day}`; // ISO 8601 형식 (YYYY-MM-DD)
    } else {
        console.warn(`[날짜 형식 오류] 예상치 못한 날짜 형식: "${rawDateStr}". "YY.MM.DD" 형식이 아닙니다.`);
        return null; // 형식이 맞지 않으면 null 반환
    }
}

// --- 데이터베이스 설정 ---
const dbFilePath = path.resolve(__dirname, 'kakaopage.db'); // DB 파일명 변경
let db;
let upsertStmt;

try {
    db = new Database(dbFilePath);
    console.log(`데이터베이스 연결 성공: ${dbFilePath}`);

    // 테이블 생성 (startDate TEXT 타입 명시)
    db.exec(`
        CREATE TABLE IF NOT EXISTS contents (
            id INTEGER PRIMARY KEY NOT NULL,
            title TEXT,
            author TEXT,
            cover TEXT,
            genre TEXT,
            views INTEGER,
            rating INTEGER,
            schedule TEXT,
            startDate TEXT, -- 날짜 문자열 (YYYY-MM-DD) 저장
            currentEp INTEGER
        )
    `);
    console.log("테이블 'contents' 확인/생성 완료 (startDate TEXT).");

    // UPSERT 구문 준비 (변경 없음)
    upsertStmt = db.prepare(`
        INSERT INTO contents (id, title, author, cover, genre, views, rating, schedule, startDate, currentEp)
        VALUES (@id, @title, @author, @cover, @genre, @views, @rating, @schedule, @startDate, @currentEp)
        ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, author=excluded.author, cover=excluded.cover, genre=excluded.genre,
            views=excluded.views, rating=excluded.rating, schedule=excluded.schedule,
            startDate=excluded.startDate, currentEp=excluded.currentEp
    `);
    console.log("UPSERT SQL 구문 준비 완료.");

} catch (dbError) {
    console.error("데이터베이스 초기화 중 오류 발생:", dbError);
    process.exit(1);
}
// --- 데이터베이스 설정 종료 ---


// --- Puppeteer 스크래핑 함수 ---
async function scrapePageData(page, targetUrl) {
    console.log(`  페이지 스크래핑 시작: ${targetUrl}`);
    let finalDataForDb = null;

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        const safeGetText = async (selector) => {
            try { return await page.$eval(selector, el => el.innerText.trim()); }
            catch (error) { return null; }
        };
        const safeGetAttribute = async (selector, attribute) => {
            try { return await page.$eval(selector, (el, attr) => el.getAttribute(attr), attribute); }
            catch (error) { return null; }
        };

        const rawData = {};
        try { // ID 추출
            const idString = targetUrl.split('/').pop();
            if (!/^\d+$/.test(idString)) { throw new Error('URL에서 유효한 숫자 ID 문자열을 추출하지 못했습니다.'); }
            rawData.id = parseInt(idString, 10);
            if (isNaN(rawData.id)) { throw new Error('ID 문자열을 정수로 변환하지 못했습니다.'); }
        } catch (e) { console.error(`    ID 추출 오류 (${targetUrl}): ${e.message}`); throw e; }

        // 나머지 데이터 추출
        rawData.cover = await safeGetAttribute('meta[property="og:image"]', 'content');
        rawData.title = await safeGetAttribute('meta[property="og:title"]', 'content');
        rawData.author = await safeGetAttribute('meta[name="author"]', 'content');
        try {
            const genreSpans = await page.$$eval('div.line-clamp-1 span.break-all.align-middle', spans => spans.map(span => span.innerText.trim()));
            rawData.genre = genreSpans.length > 1 ? genreSpans[1] : null;
        } catch (error) { rawData.genre = null; }
        rawData.viewsText = await safeGetText('img[alt="열람자"] + span');
        rawData.ratingText = await safeGetText('img[alt="별점"] + span');
        rawData.scheduleText = await safeGetText('div[class^="mt-6pxr"] span');
        try {
            const totalEpText = await safeGetText('span.font-small2-bold.text-el-70:last-child');
            if (totalEpText && totalEpText.includes("전체")) {
                const match = totalEpText.match(/\d+/);
                rawData.currentEp = match ? parseInt(match[0], 10) : null;
            } else { rawData.currentEp = null; }
        } catch (error) { rawData.currentEp = null; }
        
        // startDate 원본 추출
        rawData.startDateText = await page.evaluate(() => { // 원본 텍스트 저장
            let dateText = null;
            const listContainer = document.querySelector('div[data-t-obj*="회차목록"] > ul');
            if (listContainer) {
                const firstEpisodeLi = listContainer.querySelector('li:first-child');
                if (firstEpisodeLi) {
                    const dateElement = firstEpisodeLi.querySelector('div.font-x-small1 span.break-all.align-middle');
                    if (dateElement) { dateText = dateElement.innerText.trim(); }
                }
            }
            return dateText;
        });

        // --- 데이터 변환 ---
        finalDataForDb = {
            id: rawData.id,
            title: rawData.title,
            author: rawData.author,
            cover: rawData.cover,
            genre: rawData.genre,
            views: parseViews(rawData.viewsText),
            rating: parseRating(rawData.ratingText),
            schedule: rawData.scheduleText && rawData.scheduleText.length >= 2 ? rawData.scheduleText.slice(-2) : (rawData.scheduleText || null),
            startDate: formatDateString(rawData.startDateText), // **날짜 변환 함수 사용**
            currentEp: rawData.currentEp
        };
        // --- 데이터 변환 종료 ---

        // --- SQLite에 저장 ---
        if (finalDataForDb && finalDataForDb.id != null && db && upsertStmt) {
            try {
                upsertStmt.run(finalDataForDb); // 변환된 데이터 사용
                // console.log(`  [DB 저장 완료] id ${finalDataForDb.id}`); // 성공 로그는 메인 루프에서 출력
            } catch (dbError) {
                console.error(`  [DB 오류] id ${finalDataForDb.id} 저장 실패:`, dbError);
                throw dbError; // 트랜잭션 롤백을 위해 에러 다시 던지기 (선택 사항)
            }
        } else {
            console.warn(`  [DB 저장 데이터 불완전. id: ${finalDataForDb?.id}`);
             // 실패로 간주하고 싶다면 여기서 에러 throw
        }

    } catch (error) {
        console.error(`  페이지 스크래핑/처리 오류 (${targetUrl}):`, error.message);
        return null;
    }
    // 페이지 닫기는 메인 루프에서
    return finalDataForDb;
}

// --- 메인 실행 로직 ---
(async () => {
    let browser = null;
    let link = [];

    try {
        const cnt = Number(fs.readFileSync('cnt'))
        console.log(cnt)

        console.log("링크 파일 읽기 시작...");
        link = JSON.parse(fs.readFileSync(cnt+'.json')); // 파일명 확인!
        console.log(`${link.length}개의 URL을 읽었습니다.`);

        console.log("Puppeteer 브라우저 실행 중...");
        browser = await puppeteer.launch({ headless: true });
        console.log("브라우저 실행 완료.");

        console.log("데이터베이스 트랜잭션 시작...");
        db.exec('BEGIN');

        let successCount = 0;
        let failCount = 0;
        for (const [index, targetUrl] of link.entries()) {
            console.log(`\n[${index + 1}/${link.length}] 처리 시작: ${targetUrl}`);
            if (targetUrl === 'https://www.ftc.go.kr/bizCommPop.do?wrkr_no=2208802594') {
                continue;
            }

            let page = null;
            try {
                page = await browser.newPage();
                const scrapedData = await scrapePageData(page, targetUrl);
                if (scrapedData && scrapedData.id != null) {
                     console.log(`  [DB 저장 완료] id ${scrapedData.id}`); // DB 저장 로그는 여기서 출력
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (pageError) {
                console.error(`  URL 처리 중 오류 발생 (${targetUrl}):`, pageError);
                failCount++;
                // 개별 실패 시 롤백할지 결정. 여기서는 계속 진행하고 마지막에 커밋 시도
            } finally {
                if (page) { await page.close(); }
            }
        } // End of loop

        console.log("\n모든 URL 처리 완료. 데이터베이스 트랜잭션 커밋 중...");
        db.exec('COMMIT'); // 성공적으로 루프 완료 시 커밋
        console.log(`트랜잭션 커밋 완료. 성공: ${successCount}, 실패: ${failCount}`);

    } catch (error) {
        console.error("\n스크립트 메인 실행 중 오류 발생:", error);
        if (db && db.inTransaction) {
            try { db.exec('ROLLBACK'); console.log("오류 발생으로 데이터베이스 트랜잭션이 롤백되었습니다."); }
            catch (rollbackError) { console.error("트랜잭션 롤백 중 오류 발생:", rollbackError); }
        }
    } finally {
        if (browser) { await browser.close(); console.log("Puppeteer 브라우저 종료됨."); }
        if (db) {
            db.close((err) => {
                if (err) { return console.error('데이터베이스 연결 닫기 오류:', err.message); }
                console.log("데이터베이스 연결이 닫혔습니다.");
            });
        }
        console.log("스크립트 완전 종료.");

        fs.writeFileSync('cnt', cnt+1+'');
    }
})();