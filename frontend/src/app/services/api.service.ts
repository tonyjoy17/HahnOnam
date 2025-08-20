import { Injectable, model } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { Observable } from 'rxjs';

import {
  EventDto, TeamDto, PlayerDto,
  TeamResultPayload, IndividualResultPayload, MvpPayload
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  getEvents(): Observable<EventDto[]> {
    return this.http.get<EventDto[]>(`${this.baseUrl}/events`);
  }

  getTeams(): Observable<TeamDto[]> {
    return this.http.get<TeamDto[]>(`${this.baseUrl}/teams`);
  }

  getPlayers(): Observable<PlayerDto[]> {
    return this.http.get<PlayerDto[]>(`${this.baseUrl}/players`);
  }

  // RESTful results endpoint for both types
  postResults(eventId: number, payload: TeamResultPayload | IndividualResultPayload): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/events/${eventId}/results`, payload);
  }

  // Idempotent MVP setter
  putMvp(eventId: number, payload: MvpPayload): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/events/${eventId}/mvp`, payload);
  }
}
