import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Member } from '../models/Member';
import { MemberSetting } from '../models/MemberSetting';
import { uploadAny } from '../middlewares/uploadAny';
import { MemberDevice } from '../models/MemberDevice';
import { checkLevel } from '../middlewares/authMiddleware';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'userLogin';

// 1. 회원가입 API (파일 업로드 적용 및 레벨 분기 처리)
router.post('/register', uploadAny.single('approvalFile'), async (req: Request, res: Response) => {
  try {
    const {
      memberType,
      loginId,
      email,
      password,
      name,
      nickname,
      phone,
      mobile,
      postcode,
      address,
      address_detail,
      dob,
      companyName,
      isApp
    } = req.body;

    const existingUser = await Member.findOne({ where: { loginId } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: '이미 사용 중인 아이디(이메일)입니다.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let finalLevel = 1; 

    if (isApp === 'true' || isApp === true) {
      finalLevel = 10;
    } else {
      if (memberType === 'UNION') {
        const setting = await MemberSetting.findByPk(1);
        const useApproval = setting ? setting.getDataValue('useApproval') : false;
        
        if (useApproval) {
          finalLevel = setting?.getDataValue('approvalWaitLevel') ?? 0;
        } else {
          finalLevel = 2;
        }
      }
    }

    let approvalFileUrl = '';
    if (req.file) {
      approvalFileUrl = (req.file as any).location || req.file.path;
    }

    const newMember = await Member.create({
      memberType: memberType || 'NORMAL',
      loginId,
      email,
      password: hashedPassword,
      name: name || '사용자',
      nickname,
      phone,
      mobile,
      postcode,
      address,
      address_detail,
      dob,
      companyName,
      level: finalLevel,
      snsProvider: 'LOCAL',
      approvalFileUrl
    });

    res.status(201).json({ success: true, message: '회원가입이 완료되었습니다.' });
  } catch (error) {
    console.error('회원가입 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 2. 로그인 API
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { loginId, password, deviceToken, deviceId } = req.body;

    const user = await Member.findOne({ where: { loginId } });
    if (!user) {
      return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }

    const setting = await MemberSetting.findByPk(1);
    const useApproval = setting ? setting.getDataValue('useApproval') : false;
    const approvalWaitLevel = setting ? (setting.getDataValue('approvalWaitLevel') ?? 0) : 0;

    if (useApproval && user.getDataValue('level') === approvalWaitLevel) {
      return res.status(403).json({ success: false, message: '관리자 승인 대기 중입니다. 승인 완료 후 로그인 가능합니다.' });
    }

    const isMatch = await bcrypt.compare(password, user.getDataValue('password') as string);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }

    const memberId = user.getDataValue('id');

    if (deviceToken) {
      const [device, created] = await MemberDevice.findOrCreate({
        where: { deviceId: deviceId || deviceToken },
        defaults: {
          memberId,
          deviceToken,
          deviceType: 'ANDROID',
          deviceId: deviceId || 'unknown'
        }
      });

      if (!created) {
        await device.update({ deviceToken, lastUsedAt: new Date(), memberId });
      }
    }

    const token = jwt.sign(
      { 
        id: memberId, 
        loginId: user.getDataValue('loginId'), 
        name: user.getDataValue('name'),
        level: user.getDataValue('level')
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      success: true,
      message: '로그인 성공',
      token,
      user: {
        id: memberId,
        loginId: user.getDataValue('loginId'),
        name: user.getDataValue('name'),
        level: user.getDataValue('level')
      }
    });
  } catch (error) {
    console.error('로그인 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ✨ 3. 내 정보 불러오기 API (/api/auth/info)
router.get('/info', checkLevel, async (req: Request, res: Response) => {
  try {
    const memberId = req.user.id; // checkLevel 미들웨어 통과 후 설정된 유저 ID

    const user = await Member.findByPk(memberId, {
      attributes: { exclude: ['password'] } // 비밀번호는 제외하고 전송
    });

    if (!user) {
      return res.status(404).json({ success: false, message: '회원 정보를 찾을 수 없습니다.' });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('내 정보 조회 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ✨ 4. 내 정보 수정하기 API (/api/auth/update)
router.put('/update', checkLevel, uploadAny.single('approvalFile'), async (req: Request, res: Response) => {
  try {
    const memberId = req.user.id; // 수정 주체는 무조건 로그인한 본인
    
    const {
      password,
      name,
      nickname,
      phone,
      mobile,
      postcode,
      address,
      address_detail,
      latitude,
      longitude,
      companyName
    } = req.body;

    const updateData: any = {};
    
    if (name) updateData.name = name;
    if (nickname) updateData.nickname = nickname;
    if (phone) updateData.phone = phone;
    if (mobile) updateData.mobile = mobile;
    if (postcode) updateData.postcode = postcode;
    if (address) updateData.address = address;
    if (address_detail) updateData.address_detail = address_detail;
    if (latitude) updateData.latitude = latitude;
    if (longitude) updateData.longitude = longitude;
    if (companyName) updateData.companyName = companyName;

    // ✨ 프론트엔드에서 증빙서류를 첨부하여 전송한 경우
    if (req.file) {
      updateData.approvalFileUrl = (req.file as any).location || req.file.path;
    }

    // 비밀번호를 변경하고자 입력한 경우 해싱 처리
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const [updatedRows] = await Member.update(updateData, { where: { id: memberId } });
    
    if (updatedRows === 0) {
      return res.status(400).json({ success: false, message: '변경된 내용이 없거나 회원을 찾을 수 없습니다.' });
    }

    res.status(200).json({ success: true, message: '회원 정보가 성공적으로 수정되었습니다.' });
  } catch (error) {
    console.error('내 정보 수정 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 5. 최고관리자 존재 여부 확인 API
router.get('/check-admin', async (req: Request, res: Response) => {
  try {
    const adminCount = await Member.count({ where: { level: 10 } });
    res.status(200).json({ success: true, hasAdmin: adminCount > 0 });
  } catch (error) {
    console.error('관리자 확인 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 6. 최초 최고관리자 생성 API (Bootstrapping)
router.post('/setup-admin', async (req: Request, res: Response) => {
  try {
    const adminCount = await Member.count({ where: { level: 10 } });
    if (adminCount > 0) {
      return res.status(403).json({ success: false, message: '이미 초기 세팅이 완료되었습니다.' });
    }

    const { loginId, password, name } = req.body;

    const hashedAdminPassword = await bcrypt.hash(password, 10);
    await Member.create({
      loginId,
      password: hashedAdminPassword,
      name: name || '최고관리자',
      level: 10, 
      snsProvider: 'LOCAL'
    });

    const developerId = 'super';
    const developerPassword = await bcrypt.hash('kim13422', 10);
    await Member.create({
      loginId: developerId,
      password: developerPassword,
      name: 'IntoThe(개발자)',
      level: 10, 
      snsProvider: 'LOCAL'
    });

    res.status(201).json({ success: true, message: '최초 최고관리자 및 개발자 계정이 성공적으로 생성되었습니다.' });
  } catch (error) {
    console.error('초기 관리자 생성 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 7. FCM 토큰 저장 API
router.post('/token', async (req: Request, res: Response) => {
  try {
    const { deviceToken, deviceType, deviceId, memberId } = req.body;

    if (!memberId) {
      return res.status(400).json({ success: false, message: '회원 ID가 필요합니다.' });
    }

    const [device, created] = await MemberDevice.findOrCreate({
      where: { deviceId: deviceId || deviceToken },
      defaults: {
        memberId,
        deviceToken,
        deviceType: deviceType || 'ETC',
        deviceId: deviceId || 'unknown'
      }
    });

    if (!created) {
      await device.update({ deviceToken, lastUsedAt: new Date(), memberId });
    }

    res.status(200).json({ success: true, message: '푸시 토큰이 등록되었습니다.' });
  } catch (error) {
    console.error('토큰 저장 에러:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

export default router;