// zerov_back/src/utils/geocoder.ts (새로 생성하거나 router 파일 상단에 추가)
import axios from "axios";

const KAKAO_API_KEY = "25a1ebe667ce301732c4e9717474584e"; // 카카오 개발자 콘솔에서 발급받은 키

export async function getCoordsByAddress(address: string) {
  try {
    const response = await axios.get(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
      {
        headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` },
      }
    );

    if (response.data.documents.length > 0) {
      const { x, y } = response.data.documents[0];
      return {
        longitude: parseFloat(x), // 경도 
        latitude: parseFloat(y),  // 위도
      };
    }
    return { longitude: null, latitude: null };
  } catch (error) {
    console.error(`Geocoding error for ${address}:`, error);
    return { longitude: null, latitude: null };
  }
}