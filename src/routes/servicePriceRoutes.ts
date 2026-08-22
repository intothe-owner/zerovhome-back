import { Router, Request, Response } from 'express';
import { ServicePrice, ServiceCategory } from '../models'; 

const router = Router();

// ==========================================
// 1. 등록된 모든 요금 목록 조회 (관리자용)
// ==========================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const prices = await ServicePrice.findAll({
      // 연결된 카테고리명도 함께 불러옵니다.
      include: [{ model: ServiceCategory, attributes: ['id', 'name', 'depth', 'parentId'] }],
      order: [['categoryId', 'ASC']]
    });
    res.status(200).json({ success: true, data: prices });
  } catch (error) {
    console.error('요금 목록 조회 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ==========================================
// 2. 특정 카테고리의 요금 조회 (프론트엔드 견적 계산용)
// ==========================================
router.get('/category/:categoryId', async (req: Request, res: Response) => {
  try {
    const categoryId = Number(req.params.categoryId);
    const price = await ServicePrice.findOne({ where: { categoryId } });
    
    if (!price) {
      return res.status(404).json({ success: false, message: '해당 카테고리에 설정된 요금이 없습니다.' });
    }
    res.status(200).json({ success: true, data: price });
  } catch (error) {
    console.error('특정 카테고리 요금 조회 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ==========================================
// 3. 요금 등록 및 수정 (관리자용 - Upsert 방식)
// ==========================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const { categoryId, unitType, unitPrice, basePrice } = req.body;

    if (!categoryId || !unitType || unitPrice === undefined) {
      return res.status(400).json({ success: false, message: '필수 입력값이 누락되었습니다.' });
    }

    // 💡 해당 카테고리에 이미 요금이 설정되어 있는지 확인
    const existingPrice = await ServicePrice.findOne({ where: { categoryId } });

    if (existingPrice) {
      // 이미 존재하면 -> 수정(Update)
      await existingPrice.update({ unitType, unitPrice, basePrice });
      return res.status(200).json({ success: true, data: existingPrice, message: '요금이 성공적으로 수정되었습니다.' });
    } else {
      // 존재하지 않으면 -> 신규 등록(Create)
      const newPrice = await ServicePrice.create({ categoryId, unitType, unitPrice, basePrice: basePrice || 0 });
      return res.status(201).json({ success: true, data: newPrice, message: '요금이 성공적으로 등록되었습니다.' });
    }
  } catch (error) {
    console.error('요금 등록/수정 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ==========================================
// 4. 요금 설정 삭제 (관리자용)
// ==========================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const deletedCount = await ServicePrice.destroy({ where: { id } });
    
    if (deletedCount === 0) {
      return res.status(404).json({ success: false, message: '삭제할 요금 정보를 찾을 수 없습니다.' });
    }
    
    res.status(200).json({ success: true, message: '요금 설정이 삭제되었습니다.' });
  } catch (error) {
    console.error('요금 삭제 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

export default router;