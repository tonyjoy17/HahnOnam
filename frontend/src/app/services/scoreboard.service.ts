import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

export type HighlightTopTeam = {
  teamId: number; teamName: string;
  gold: number; silver: number; bronze: number;
  totalPoints: number;
};

export type HighlightMvp = {
  eventId: number; eventName: string;
  playerId: number; playerName: string;
  teamId: number; teamName: string;
  points: number;
};

export type HighlightsResponse = {
  topTeam: HighlightTopTeam | null;
  topPlayer: HighlightTopPlayer  | null;
};

export type HighlightTopPlayer = {
  playerId: number; playerName: string;
  teamId: number; teamName: string;
  points: number;
  gold: number; silver: number; bronze: number;
};


export type TeamRankRow = {
  teamId: number; teamName: string;
  gold: number; silver: number; bronze: number;
  totalPoints: number; rank: number;
};

export type PlayerRankRow = {
  playerId: number; playerName: string;
  teamId: number; teamName: string;
  gold: number; silver: number; bronze: number;
  totalPoints: number; rank: number;
};

export type Player = {
  id: number;
  name: string;
  teamId: number;
};

@Injectable({ providedIn: 'root' })
export class ScoreboardService {

    private readonly baseUrl = environment.apiBaseUrl;
  constructor(private http: HttpClient) {}

  getHighlights() {
    return this.http.get<HighlightsResponse>(`${this.baseUrl}/highlights`);
  }

  getTeamRanked() {
    return this.http.get<TeamRankRow[]>(`${this.baseUrl}/standings/ranked`);
  }

  getPlayerRanked() {
    return this.http.get<PlayerRankRow[]>(`${this.baseUrl}/standings/players`);
  }
  getPlayers() {
  return this.http.get<Player[]>(`${this.baseUrl}/players`);
}
}
