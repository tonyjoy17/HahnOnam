// src/app/services/models.ts
export type EventType = 'team' | 'individual';

export interface EventDto {
  id: number;
  name: string;
  type: EventType;
}

export interface TeamDto {
  id: number;
  name: string;
}

export interface PlayerDto {
  id: number;
  name: string;
  teamId: number;
}

export interface TeamResultPayload {
  eventId: number;
  type: 'team';
  winnerTeamId: number;
  secondTeamId: number;
}

export interface IndividualResultPayload {
  eventId: number;
  type: 'individual';
  firstPlayerId: number;
  secondPlayerId: number;
  thirdPlayerId: number;
}

export interface MvpPayload {
  eventId: number;
  playerId: number;
}
