import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { Reservation, ServiceCategory, Member } from '../models'; 
import { sequelize } from '../config/database';

const router = Router();

// ==========================================
// 1. [고객] 예약 및 견적 신청
// ==========================================
router.post('/', async (req: Request, res: Response) => {
  const transaction = await sequelize.transaction();
  try {
    const {
      category1Id,
      category2Id,
      unitCount,
      totalPrice,
      customerName,
      customerPhone,
      address,
      detailAddress,
      reservationDate,
      reservationTime,
      extraDetails,
      privacyAgreed
    } = req.body;

    // 1) 개인정보 동의 체크
    if (!privacyAgreed) {
      return res.status(400).json({ success: false, message: '개인정보취급방침에 동의해야 합니다.' });
    }

    // 2) 동일 날짜, 동일 시간대 중복 예약 방지
    const existingReservation = await Reservation.findOne({
      where: {
        reservationDate,
        reservationTime
      }
    });

    if (existingReservation) {
      return res.status(409).json({ success: false, message: '선택하신 날짜와 시간에는 이미 예약이 존재합니다.' });
    }

    // 3) 예약 생성
    const newReservation = await Reservation.create({
      category1Id,
      category2Id,
      unitCount,
      totalPrice,
      customerName,
      customerPhone,
      address,
      detailAddress,
      reservationDate,
      reservationTime,
      privacyAgreed,
      extraDetails,
      status: 'PENDING' // 초기 상태: 대기중
    }, { transaction });

    await transaction.commit();

    // 💡 [알림 발송 포인트] 
    // 여기서 관리자(혹은 담당자)에게 푸시 알림, 이메일, 알림톡 등을 발송하는 로직을 추가할 수 있습니다.
    // ex) sendAdminNotification('새로운 예약 신청이 접수되었습니다.', newReservation.id);

    res.status(201).json({ 
      success: true, 
      data: newReservation, 
      message: '예약 신청이 완료되었습니다.' 
    });

  } catch (error) {
    await transaction.rollback();
    console.error('예약 신청 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ==========================================
// 2. [관리자] 예약 목록 조회 및 검색 (이름/전화번호)
// ==========================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const { name, phone, status, startDate, endDate } = req.query;
    
    // 동적 검색 조건 생성
    const whereCondition: any = {};

    // 1) 이름으로 조회 (포함 검색)
    if (name) {
      whereCondition.customerName = { [Op.like]: `%${name}%` };
    }

    // 2) 전화번호로 조회 (포함 검색)
    if (phone) {
      whereCondition.customerPhone = { [Op.like]: `%${phone}%` };
    }

    // 3) 상태별 조회 (PENDING, ASSIGNED, IN_PROGRESS, COMPLETED 등)
    if (status) {
      whereCondition.status = status;
    }

    // 4) 날짜 기간 조회 (선택 사항)
    if (startDate && endDate) {
      whereCondition.reservationDate = {
        [Op.between]: [startDate, endDate]
      };
    }

    // 조회 실행 (연결된 카테고리와 직원 정보 포함)
    const reservations = await Reservation.findAll({
      where: whereCondition,
      include: [
        { model: ServiceCategory, as: 'category1', attributes: ['id', 'name'] },
        { model: ServiceCategory, as: 'category2', attributes: ['id', 'name'] },
        { model: Member, as: 'worker', attributes: ['id', 'name', 'phone'] } // 배정된 직원 정보
      ],
      order: [
        ['reservationDate', 'DESC'],
        ['reservationTime', 'DESC']
      ]
    });

    res.status(200).json({ success: true, data: reservations });
  } catch (error) {
    console.error('예약 목록 조회 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ==========================================
// 3. [관리자] 예약 상세 조회
// ==========================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const reservationId = Number(req.params.id);
    const reservation = await Reservation.findByPk(reservationId, {
      include: [
        { model: ServiceCategory, as: 'category1', attributes: ['id', 'name'] },
        { model: ServiceCategory, as: 'category2', attributes: ['id', 'name'] },
        { model: Member, as: 'worker', attributes: ['id', 'name', 'phone', 'companyName'] }
      ]
    });

    if (!reservation) {
      return res.status(404).json({ success: false, message: '예약 내역을 찾을 수 없습니다.' });
    }

    res.status(200).json({ success: true, data: reservation });
  } catch (error) {
    console.error('예약 상세 조회 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ==========================================
// 4. [관리자] 직원 배정 및 상태 변경
// ==========================================
router.put('/:id/assign', async (req: Request, res: Response) => {
  try {
    const reservationId = Number(req.params.id);
    const { workerId, status , reservationDate, reservationTime, totalPrice} = req.body;

    const reservation = await Reservation.findByPk(reservationId);
    if (!reservation) {
      return res.status(404).json({ success: false, message: '예약 내역을 찾을 수 없습니다.' });
    }

    // 직원 배정 및 상태 업데이트 (예: PENDING -> ASSIGNED)
    await reservation.update({
      workerId: workerId || reservation.workerId,
      status: status || 'ASSIGNED',
      reservationDate,   // 💡 추가됨
      reservationTime,   // 💡 추가됨
      totalPrice
    });

    res.status(200).json({ success: true, message: '직원 배정이 완료되었습니다.', data: reservation });
  } catch (error) {
    console.error('직원 배정 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

export default router;