import cron from 'node-cron';
import { 
  scrapeBizInfo, 
  scrapeSbiz24, 
  scrapeKStartup, 
  scrapeKdissw, 
  scrapeBusanjh 
} from '../services/scraperService';

export const initScheduler = () => {
  // 매일 오전 8시 00분
  cron.schedule('00 8 * * *', async () => {
    try {
      console.log('⏰ [스케줄러] 기업마당 자동 수집 시작');
      await scrapeBizInfo();
    } catch (error) {
      console.error('기업마당 스케줄러 에러:', error);
    }
  });

  // 매일 오전 8시 10분
  cron.schedule('10 8 * * *', async () => {
    try {
      console.log('⏰ [스케줄러] 소상공인24 자동 수집 시작');
      await scrapeSbiz24();
    } catch (error) {
      console.error('소상공인24 스케줄러 에러:', error);
    }
  }); 

  

  // 매일 오전 8시 20분
  cron.schedule('20 8 * * *', async () => {
    try {
      console.log('⏰ [스케줄러] 자활센터(한국/부산) 자동 수집 시작');
      await scrapeKdissw();
      await scrapeBusanjh();
    } catch (error) {
      console.error('자활센터 스케줄러 에러:', error);
    }
  });

  console.log('✅ 크롤링 스케줄러가 백그라운드에 등록되었습니다.');
};