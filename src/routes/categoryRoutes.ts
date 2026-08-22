import { Router, Request, Response } from 'express';
// 앞서 통합한 models/index.ts 에서 가져온다고 가정
import { ServiceCategory } from '../models'; 
import { sequelize } from '../config/database'; // 트랜잭션 처리를 위해 추가

const router = Router();

// 1. 카테고리 전체 목록 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const categories = await ServiceCategory.findAll({
      order: [
        ['parentId', 'ASC'],
        ['order', 'ASC'],
      ],
    });
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    console.error('카테고리 조회 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 2. 드래그 앤 드롭 순서 일괄 변경
router.put('/reorder', async (req: Request, res: Response) => {
  const transaction = await sequelize.transaction();
  try {
    const { categories } = req.body; // { id, parentId, depth, order } 배열
    
    // 반복문을 돌며 각 카테고리의 순서와 부모 ID 업데이트
    for (const category of categories) {
      await ServiceCategory.update(
        { parentId: category.parentId, depth: category.depth, order: category.order },
        { where: { id: category.id }, transaction }
      );
    }
    
    await transaction.commit();
    res.status(200).json({ success: true, message: '카테고리 순서가 변경되었습니다.' });
  } catch (error) {
    await transaction.rollback();
    console.error('카테고리 순서 변경 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 3. 새 카테고리 생성
router.post('/', async (req: Request, res: Response) => {
  try {
    // url 대신 isActive(사용 여부) 추가
    const { name, parentId, depth, order, isActive } = req.body;
    const newCategory = await ServiceCategory.create({ name, parentId, depth, order, isActive });
    res.status(201).json({ success: true, data: newCategory, message: '카테고리가 추가되었습니다.' });
  } catch (error) {
    console.error('카테고리 생성 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 4. 기존 카테고리 수정 (인라인 수정용)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const categoryId = Number(req.params.id);
    const { name, isActive } = req.body;
    
    await ServiceCategory.update({ name, isActive }, { where: { id: categoryId } });
    const updatedCategory = await ServiceCategory.findByPk(categoryId);
    
    res.status(200).json({ success: true, data: updatedCategory, message: '카테고리가 수정되었습니다.' });
  } catch (error) {
    console.error('카테고리 수정 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 5. 카테고리 삭제
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const categoryId = Number(req.params.id);
    const childCategories = await ServiceCategory.count({ where: { parentId: categoryId } });
    
    // 하위(2차) 카테고리가 있으면 1차 카테고리 삭제 방지
    if (childCategories > 0) {
      return res.status(400).json({ success: false, message: '하위 카테고리가 존재하여 삭제할 수 없습니다.' });
    }

    await ServiceCategory.destroy({ where: { id: categoryId } });
    res.status(200).json({ success: true, message: '카테고리가 삭제되었습니다.' });
  } catch (error) {
    console.error('카테고리 삭제 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

export default router;