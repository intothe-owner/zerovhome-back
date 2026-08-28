import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import https from 'https';
import { Op } from 'sequelize';
import { SupportFund } from '../models/SupportFund';
import { Member } from '../models/Member';
import { MemberDevice } from '../models/MemberDevice';
import { getMessaging } from 'firebase-admin/messaging';

// ==========================================
// 💡 [신규] 레벨 10 회원에게 순차적으로 푸시를 보내는 헬퍼 함수
// ==========================================
const sendPushForNewFunds = async (newFunds: any[]) => {
  if (!newFunds || newFunds.length === 0) return;

  try {
    // 1. 레벨 10 회원의 활성화된 디바이스 토큰 조회
    const adminDevices = await MemberDevice.findAll({
      include: [{
        model: Member,
        as: 'member',
        where: { level: 10 }
      }],
      where: { isPushActive: true }
    });

    const tokens = adminDevices.map(device => device.getDataValue('deviceToken'));

    // 토큰이 없으면 발송 취소
    if (tokens.length === 0) {
      console.log('푸시를 수신할 레벨 10 관리자 디바이스가 없습니다.');
      return;
    }

    console.log(`총 ${newFunds.length}개의 신규 공고에 대해 순차적 푸시 발송을 시작합니다...`);

    // 2. 신규 공고들에 대해 순차적으로 알림 발송
    for (const fund of newFunds) {
      const message = {
        notification: {
          title: '신규 지원사업 등록 알림',
          body: `[${fund.category}] ${fund.title}`
        },
        tokens: tokens,
      };

      try {
        const response = await getMessaging().sendEachForMulticast(message);
        console.log(`[푸시 발송 완료] ${fund.title} (성공: ${response.successCount}, 실패: ${response.failureCount})`);
      } catch (err) {
        console.error(`[푸시 발송 실패] ${fund.title}:`, err);
      }

      // 서버와 FCM 스팸 방지를 위해 발송 간 1초(1000ms) 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('신규 공고 푸시 발송 중 전체 에러:', error);
  }
};


// 1. 기업마당 크롤링
export const scrapeBizInfo = async () => {
  console.log('--- 🔍 [기업마당] 크롤링 시작 ---');
  const results: any = [];
  const maxPage = 1;
  const baseUrl = 'https://www.bizinfo.go.kr';

  for (let page = 1; page <= maxPage; page++) {
    const url = `${baseUrl}/sii/siia/selectSIIA200View.do?null=&rows=15&cpage=${page}`;
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    $('div.table_Type_1 table tbody tr').each((_, element) => {
      const tds = $(element).find('td');
      if (tds.length < 5) return;

      const category = '기업마당';
      const titleAnchor = $(tds[2]).find('a');
      const title = titleAnchor.text().trim();
      const period = $(tds[3]).text().trim();
      const department = $(tds[4]).text().trim();

      let detailUrl = '';
      const hrefAttr = titleAnchor.attr('href') || '';
      if (hrefAttr) {
        detailUrl = hrefAttr.startsWith('http') ? hrefAttr : baseUrl + hrefAttr;
        detailUrl = detailUrl.replace(/&amp;/g, '&');
      }

      if (title) {
        results.push({ category, title, period, department, detailUrl });
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  let updateCount = 0;
  const newlyAddedFunds: any[] = []; // ✨ 신규 공고를 담을 배열

  for (const item of results) {
    const existingFund = await SupportFund.findOne({ where: { title: item.title } });
    if (existingFund) {
      await existingFund.update(item);
      updateCount++;
    } else {
      await SupportFund.create(item);
      newlyAddedFunds.push(item); // 신규 등록된 항목 추가
    }
  }

  // ✨ 신규 항목이 있다면 푸시 순차 발송
  await sendPushForNewFunds(newlyAddedFunds);

  console.log(`[기업마당] 완료! (신규: ${newlyAddedFunds.length}개, 갱신: ${updateCount}개)`);
  return { newCount: newlyAddedFunds.length, updateCount };
};

// 2. 소상공인24 크롤링
export const scrapeSbiz24 = async () => {
  console.log('--- 🔍 [소상공인24] 크롤링 시작 ---');
  let browser;
  try {
    const maxPage = 1;
    const baseUrl = 'https://www.sbiz24.kr';
    const results: any[] = [];

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();

    for (let i = 1; i <= maxPage; i++) {
      const targetUrl = `${baseUrl}/#/combinePbancList?page=${i}`;
      await page.goto(targetUrl, { waitUntil: 'networkidle2' });

      const pageData = await page.evaluate((currentBaseUrl) => {
        const scraped: any[] = [];
        const items = document.querySelectorAll('.pbanc-list-wrap li, table tbody tr');

        items.forEach((el) => {
          const titleEl = el.querySelector('a, .title, .tit');
          if (!titleEl) return;
          const title = titleEl.textContent?.trim() || '';

          let detailUrl = '';
          const aTag = el.querySelector('a');
          if (aTag) detailUrl = aTag.href;

          const category = '소상공인정책자금';
          const period = el.querySelector('.c_aplyPd')?.textContent?.trim() || '';
          const department = el.querySelector('.agency, .dept')?.textContent?.trim() || '소상공인시장진흥공단';

          scraped.push({ category, title, period, department, detailUrl });
        });
        return scraped;
      }, baseUrl);

      results.push(...pageData);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (results.length > 0) {
      const scrapedTitles = results.map(item => item.title);
      const existingRecords = await SupportFund.findAll({
        where: { title: { [Op.in]: scrapedTitles } },
        attributes: ['title']
      });

      const existingTitles = new Set(existingRecords.map(record => record.title));
      const newResults: any[] = [];
      const seenTitles = new Set();

      for (const item of results) {
        if (!existingTitles.has(item.title) && !seenTitles.has(item.title)) {
          newResults.push(item);
          seenTitles.add(item.title);
        }
      }

      if (newResults.length > 0) {
        await SupportFund.bulkCreate(newResults);
        
        // ✨ 신규 데이터 배열 그대로 푸시 발송
        await sendPushForNewFunds(newResults);
      }
      console.log(`[소상공인24] 완료! 전체 ${results.length}개 중 신규 ${newResults.length}개`);
      return { total: results.length, newCount: newResults.length };
    }
    return { total: 0, newCount: 0 };
  } finally {
    if (browser) await browser.close();
  }
};

// 3. K-Startup 크롤링
export const scrapeKStartup = async () => {
  console.log('--- 🔍 [K-Startup] 크롤링 시작 ---');
  const results: any = [];
  const baseUrl = 'https://www.k-startup.go.kr';
  const targetUrl = `${baseUrl}/web/contents/bizpbanc-ongoing.do`;

  const response = await axios.get(targetUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  const $ = cheerio.load(response.data);
  $('#bizPbancList ul li.notice').each((_, element) => {
    const title = $(element).find('.middle p.tit').text().trim();
    if (!title) return;

    const category = 'K-Startup';
    let detailUrl = '';
    const hrefAttr = $(element).find('.middle a').attr('href') || '';
    const match = hrefAttr.match(/go_view\(([0-9]+)\)/);
    if (match && match[1]) {
      detailUrl = `${baseUrl}/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${match[1]}`;
    }

    let department = ''; let startDate = ''; let endDate = ''; let period = '';
    $(element).find('.bottom span.list').each((index, el) => {
      const text = $(el).text().trim();
      if (index === 1) department = text;
      if (text.startsWith('시작일자')) startDate = text.replace('시작일자', '').trim();
      if (text.startsWith('마감일자')) endDate = text.replace('마감일자', '').trim();
    });

    if (startDate || endDate) period = `${startDate} ~ ${endDate}`;
    results.push({ category, title, period, department, detailUrl });
  });

  let insertedCount = 0;
  if (results.length > 0) {
    const scrapedTitles = results.map((item: any) => item.title);
    const existingData = await SupportFund.findAll({
      where: { title: { [Op.in]: scrapedTitles } },
      attributes: ['title']
    });

    const existingTitles = new Set(existingData.map((item: any) => item.title));
    const newResults = results.filter((item: any) => !existingTitles.has(item.title));

    if (newResults.length > 0) {
      await SupportFund.bulkCreate(newResults);
      insertedCount = newResults.length;

      // ✨ 신규 데이터 배열 그대로 푸시 발송
      await sendPushForNewFunds(newResults);
    }
  }
  console.log(`[K-Startup] 완료! 신규 ${insertedCount}개`);
  return { insertedCount };
};

// 4. 한국자활복지개발원 크롤링
export const scrapeKdissw = async () => {
  console.log('--- 🔍 [한국자활] 크롤링 시작 ---');
  const results: any[] = [];
  const baseUrl = 'https://www.kdissw.or.kr';
  const targetUrl = 'https://www.kdissw.or.kr/board.es?mid=a10501040000&bid=0046';

  const response = await axios.get(targetUrl, {
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  const $ = cheerio.load(response.data);
  $('.tstyle_list .dbody ul').each((_, ulElement) => {
    const aTag = $(ulElement).find('li.title a').first();
    if (!aTag.length) return;

    let rawTitle = aTag.attr('title') || aTag.text();
    let title = rawTitle.replace(/\s+/g, ' ').trim();
    if (!title) return;

    const author = $(ulElement).find('li[aria-title="작성자"]').text().trim();
    const department = author || '한국자활복지개발원';
    const category = '한국자활';

    let detailUrl = '';
    const href = aTag.attr('href') || '';
    if (href) detailUrl = href.startsWith('http') ? href : baseUrl + (href.startsWith('/') ? href : `/${href}`);

    let period = '-';
    const dateMatch = $(ulElement).text().match(/\d{4}[\/\.\-]\d{2}[\/\.\-]\d{2}/);
    if (dateMatch) period = dateMatch[0];

    results.push({ category, title, period, department, detailUrl });
  });

  let updateCount = 0;
  const newlyAddedFunds: any[] = [];

  for (const item of results.filter(item => item?.title)) {
    const existingFund = await SupportFund.findOne({ where: { title: item.title } });
    if (existingFund) {
      await existingFund.update(item);
      updateCount++;
    } else {
      await SupportFund.create(item);
      newlyAddedFunds.push(item);
    }
  }

  // ✨ 신규 항목 푸시 발송
  await sendPushForNewFunds(newlyAddedFunds);

  console.log(`[한국자활] 완료! (신규: ${newlyAddedFunds.length}, 갱신: ${updateCount})`);
  return { newCount: newlyAddedFunds.length, updateCount };
};

// 5. 부산광역자활센터 크롤링
export const scrapeBusanjh = async () => {
  console.log('--- 🔍 [부산자활] 크롤링 시작 ---');
  const results: any[] = [];
  const sca = encodeURIComponent('공지');
  const baseUrl = 'https://www.busanjh.or.kr';
  const targetUrl = `https://www.busanjh.or.kr/bbs/board.php?bo_table=notice2&sca=${sca}`;

  const response = await axios.get(targetUrl, {
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  const $ = cheerio.load(response.data);
  $('.bbs-list > ul > li').each((_, element) => {
    const aTag = $(element).find('a.aline');
    if (!aTag.length) return;

    let rawTitle = aTag.attr('title') || aTag.text();
    let title = rawTitle.replace(/\s+/g, ' ').trim();
    if (!title) return;

    const category = '부산자활';
    const author = $(element).find('.pname').text().trim();
    const department = author || '부산광역자활센터';

    let detailUrl = '';
    const hrefAttr = aTag.attr('href') || '';
    if (hrefAttr) detailUrl = hrefAttr.startsWith('http') ? hrefAttr : baseUrl + '/bbs/' + hrefAttr.replace(/^\.\//, '');

    let period = $(element).find('span.date').text().trim();
    const dateMatch = period.match(/\d{4}[\.\-]\d{2}[\.\-]\d{2}/);
    if (dateMatch) period = dateMatch[0];

    results.push({ category, title, period, department, detailUrl });
  });

  let updateCount = 0;
  const newlyAddedFunds: any[] = [];

  for (const item of results.filter(item => item?.title)) {
    const existingFund = await SupportFund.findOne({ where: { title: item.title } });
    if (existingFund) {
      await existingFund.update(item);
      updateCount++;
    } else {
      await SupportFund.create(item);
      newlyAddedFunds.push(item);
    }
  }

  // ✨ 신규 항목 푸시 발송
  await sendPushForNewFunds(newlyAddedFunds);

  console.log(`[부산자활] 완료! (신규: ${newlyAddedFunds.length}, 갱신: ${updateCount})`);
  return { newCount: newlyAddedFunds.length, updateCount };
};