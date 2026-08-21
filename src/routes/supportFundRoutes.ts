import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { SupportFund } from '../models/SupportFund';
import { 
  scrapeBizInfo, 
  scrapeSbiz24, 
  scrapeKStartup, 
  scrapeKdissw, 
  scrapeBusanjh 
} from '../services/scraperService';

const router = Router();

// ==========================================
// 수동 크롤링 트리거 API 
// (프론트엔드 버튼 클릭이나 관리자 페이지용)
// ==========================================
router.post('/scrape', async (req: Request, res: Response) => {
  try {
    const { newCount, updateCount } = await scrapeBizInfo();
    res.json({ success: true, message: `기업마당 갱신 완료 (신규: ${newCount} / 갱신: ${updateCount})` });
  } catch (error) {
    res.status(500).json({ success: false, message: '기업마당 수집 중 오류 발생' });
  }
});

router.post('/scrape/sbiz24', async (req: Request, res: Response) => {
  try {
    const { total, newCount } = await scrapeSbiz24();
    res.json({ success: true, message: `소상공인24 수집 완료 (전체: ${total} / 신규: ${newCount})` });
  } catch (error) {
    res.status(500).json({ success: false, message: '소상공인24 수집 중 오류 발생' });
  }
});

router.post('/scrape/k-startup', async (req: Request, res: Response) => {
  try {
    const { insertedCount } = await scrapeKStartup();
    res.json({ success: true, message: `K-Startup 수집 완료 (신규: ${insertedCount})` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'K-Startup 수집 중 오류 발생' });
  }
});

router.post('/scrape/kdissw', async (req: Request, res: Response) => {
  try {
    const { newCount, updateCount } = await scrapeKdissw();
    res.json({ success: true, message: `한국자활 갱신 완료 (신규: ${newCount} / 갱신: ${updateCount})` });
  } catch (error) {
    res.status(500).json({ success: false, message: '한국자활 수집 중 오류 발생' });
  }
});

router.post('/scrape/busanjh', async (req: Request, res: Response) => {
  try {
    const { newCount, updateCount } = await scrapeBusanjh();
    res.json({ success: true, message: `부산자활 갱신 완료 (신규: ${newCount} / 갱신: ${updateCount})` });
  } catch (error) {
    res.status(500).json({ success: false, message: '부산자활 수집 중 오류 발생' });
  }
});

// ==========================================
// 데이터 조회, 검색 및 페이징 API
// ==========================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page || '1'), 10);
    const limit = parseInt(String(req.query.limit || '20'), 10);
    const offset = (page - 1) * limit;

    const category = req.query.category as string;
    const department = req.query.department as string;
    const title = req.query.title as string;

    const where: any = {};
    if (category) where.category = { [Op.like]: `%${category}%` };
    if (department) where.department = { [Op.like]: `%${department}%` };
    if (title) {
      where[Op.or] = [
        { title: { [Op.like]: `%${title}%` } },
        { department: { [Op.like]: `%${title}%` } }
      ];
    }

    const { count, rows: funds } = await SupportFund.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset,
    });

    res.json({
      success: true,
      data: funds,
      pagination: {
        totalItems: count,
        currentPage: page,
        itemsPerPage: limit,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('조회 에러:', error);
    res.status(500).json({ success: false, message: '조회 실패' });
  }
});

export default router;