// src/models/index.ts
import { SiteSetting } from './SiteSetting';
import { Menu } from './Menu';
import { Page } from './Page';
import { BoardConfig } from './BoardConfig';
import { Post } from './Post';
import { Comment } from './Comment';
import { MemberSetting } from './MemberSetting';
import { Member } from './Member';
import { VisitorLog } from './VisitorLog';
import { Policy } from './Policy';
import { MemberDevice } from './MemberDevice';
import { Certification } from './Certification';
// --- 새로 추가된 모델 임포트 (클린업 & 설문조사) ---
import { CleanUpHousehold } from './CleanUpHousehold';
import { SeniorCenterCleanUp } from './SeniorCenterCleanUp';
import { Survey } from './Survey';
import { SurveyResponse } from './SurveyResponse';

// 예약신청 테이블
import { ServiceCategory } from './ServiceCategory';
import { ServicePrice } from './ServicePrice';
import { Reservation } from './Reservation';
import { WorkReport } from './WorkReport';

//통합 작업
import { WorkSite } from './WorkSite';
import { WorkItem } from './WorkItem';
import { SiteSurvey } from './SiteSurvey';
import { SiteSurveyResponse } from './SiteSurveyResponse';
import { SiteReportForm } from './SiteReportForm';
import { SiteReportResult } from './SiteReportResult';

// --- 테이블 간의 관계(Relation) 정의 ---

// 1. 메뉴-메뉴 (자기참조)
Menu.hasMany(Menu, { as: 'subMenus', foreignKey: 'parentId', onDelete: 'CASCADE' });
Menu.belongsTo(Menu, { as: 'parentMenu', foreignKey: 'parentId' });

// 2. 메뉴-페이지 (메뉴 삭제 시 연결된 페이지 설정도 논리 삭제) 
Menu.hasOne(Page, { foreignKey: 'menuId', onDelete: 'CASCADE' });
Page.belongsTo(Menu, { foreignKey: 'menuId' });

// 3. 메뉴-게시판설정 (메뉴 삭제 시 게시판도 종속적으로 논리 삭제)
Menu.hasOne(BoardConfig, { foreignKey: 'menuId', onDelete: 'CASCADE' });
BoardConfig.belongsTo(Menu, { foreignKey: 'menuId' }); 

// 4. 게시판설정-게시물 (게시판 삭제 시 안에 든 글들도 삭제)
BoardConfig.hasMany(Post, { foreignKey: 'boardConfigId', onDelete: 'CASCADE' });
Post.belongsTo(BoardConfig, { foreignKey: 'boardConfigId' });

// 5. 게시물-댓글 (글 삭제 시 댓글도 삭제)
Post.hasMany(Comment, { foreignKey: 'postId', onDelete: 'CASCADE' });  
Comment.belongsTo(Post, { foreignKey: 'postId' });
 
// (선택) 회원-게시물 관계 설정
Member.hasMany(Post, { foreignKey: 'memberId' });
Post.belongsTo(Member, { foreignKey: 'memberId' });

// 1:N 관계 설정: Member(1) -> MemberDevice(N)
Member.hasMany(MemberDevice, { 
  foreignKey: 'memberId', 
  as: 'devices', // 조회할 때 사용할 별칭
  onDelete: 'CASCADE' // 회원이 탈퇴(삭제)되면 기기 정보도 함께 삭제됨
});
MemberDevice.belongsTo(Member, { 
  foreignKey: 'memberId',
  as: 'member'
});

// --- 새로 추가된 클린업 & 설문조사 관계 설정 ---

// 6. 설문조사 - 설문응답 (설문조사 삭제 시 응답 내역도 삭제)
Survey.hasMany(SurveyResponse, { foreignKey: 'surveyId', as: 'surveyResponses', onDelete: 'CASCADE' });
SurveyResponse.belongsTo(Survey, { foreignKey: 'surveyId', as: 'survey' });

// 7. 클린업 가구 - 설문응답 (가구 데이터 삭제 시 해당 가구의 설문응답도 삭제)
CleanUpHousehold.hasMany(SurveyResponse, { foreignKey: 'householdId', onDelete: 'CASCADE',as: 'surveyResponses', });
SurveyResponse.belongsTo(CleanUpHousehold, { foreignKey: 'householdId',as: 'household' });

// 경로당(SeniorCenterCleanUp)은 현재 다른 테이블과 연관관계가 없으므로 단독으로 둡니다.

// 1. 카테고리 1차-2차 관계 (자기 참조)
ServiceCategory.hasMany(ServiceCategory, { as: 'subCategories', foreignKey: 'parentId', onDelete: 'CASCADE' });
ServiceCategory.belongsTo(ServiceCategory, { as: 'parentCategory', foreignKey: 'parentId' });

// 2. 카테고리 - 요금 설정 (1:N)
ServiceCategory.hasMany(ServicePrice, { foreignKey: 'categoryId', onDelete: 'CASCADE' });
ServicePrice.belongsTo(ServiceCategory, { foreignKey: 'categoryId' });

// 3. 예약 - 카테고리 참조
Reservation.belongsTo(ServiceCategory, { as: 'category1', foreignKey: 'category1Id' });
Reservation.belongsTo(ServiceCategory, { as: 'category2', foreignKey: 'category2Id' });

// 4. 예약 - 회원(직원) 할당 관계
// 기존에 존재하는 Member 모델을 직원으로 사용합니다.
Member.hasMany(Reservation, { foreignKey: 'workerId', as: 'assignedTasks' });
Reservation.belongsTo(Member, { foreignKey: 'workerId', as: 'worker' });

// 5. 예약 - 작업 보고서 (1:1)
Reservation.hasOne(WorkReport, { foreignKey: 'reservationId', onDelete: 'CASCADE' });
WorkReport.belongsTo(Reservation, { foreignKey: 'reservationId' });

// 1. 작업현장(1) - 작업목록(N)
WorkSite.hasMany(WorkItem, { foreignKey: 'workSiteId', as: 'items', onDelete: 'CASCADE' });
WorkItem.belongsTo(WorkSite, { foreignKey: 'workSiteId', as: 'site' });

// 2. 회원(1) - 작업목록(N) : 작업자 배정[cite: 7]
Member.hasMany(WorkItem, { foreignKey: 'assignedMemberId', as: 'assignedWorks' }); // 💡 별칭을 변경
WorkItem.belongsTo(Member, { foreignKey: 'assignedMemberId', as: 'worker' });

// 1. 작업현장(1) - 현장설문폼(1)
WorkSite.hasOne(SiteSurvey, { foreignKey: 'workSiteId', as: 'surveyForm', onDelete: 'CASCADE' });
SiteSurvey.belongsTo(WorkSite, { foreignKey: 'workSiteId', as: 'workSite' });

// 2. 개별작업목록(1) - 설문응답(1)
WorkItem.hasOne(SiteSurveyResponse, { foreignKey: 'workItemId', as: 'surveyResponse', onDelete: 'CASCADE' });
SiteSurveyResponse.belongsTo(WorkItem, { foreignKey: 'workItemId', as: 'workItem' });

// 3. 현장설문폼(1) - 설문응답(N)
SiteSurvey.hasMany(SiteSurveyResponse, { foreignKey: 'siteSurveyId', as: 'responses', onDelete: 'CASCADE' });
SiteSurveyResponse.belongsTo(SiteSurvey, { foreignKey: 'siteSurveyId', as: 'surveyForm' });


// 1. 작업현장(1) - 보고서양식(1)
WorkSite.hasOne(SiteReportForm, { foreignKey: 'workSiteId', as: 'reportForm', onDelete: 'CASCADE' });
SiteReportForm.belongsTo(WorkSite, { foreignKey: 'workSiteId', as: 'workSite' });

// 2. 개별작업(1) - 보고서결과(1)
WorkItem.hasOne(SiteReportResult, { foreignKey: 'workItemId', as: 'reportResult', onDelete: 'CASCADE' });
SiteReportResult.belongsTo(WorkItem, { foreignKey: 'workItemId', as: 'workItem' });

// 3. 담당자(1) - 보고서결과(N)
Member.hasMany(SiteReportResult, { foreignKey: 'workerId', as: 'submittedReports' });
SiteReportResult.belongsTo(Member, { foreignKey: 'workerId', as: 'worker' });

export { 
  Menu, 
  Page, 
  BoardConfig, 
  Post, 
  Comment, 
  SiteSetting, 
  Member,
  MemberSetting,
  MemberDevice,
  VisitorLog,
  Policy,
  CleanUpHousehold, 
  SeniorCenterCleanUp, 
  Survey, 
  SurveyResponse,
  ServiceCategory,
  ServicePrice,
  Reservation,
  WorkReport,
  Certification,
  // 새로 추가된 통합 작업 모델 익스포트
  WorkSite,
  WorkItem,
  SiteSurvey,
  SiteSurveyResponse,
  SiteReportForm,
  SiteReportResult
};