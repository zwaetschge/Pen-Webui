export type GameRoomCharacter = {
  id: string;
  name: string;
  portraitUrl: string | null;
  level: number;
  className: string;
  race: string;
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  ac: number;
  speed: number;
  passivePerception: number;
};
