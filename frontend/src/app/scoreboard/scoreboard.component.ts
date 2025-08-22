import { Component, OnInit } from '@angular/core';
import {
  ScoreboardService,
  HighlightsResponse,
  TeamRankRow,
  PlayerRankRow,
  Player,
  EventResult
} from '../services/scoreboard.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-scoreboard',
  standalone: false,
  templateUrl: './scoreboard.component.html',
  styleUrls: ['./scoreboard.component.css']
})
export class ScoreboardComponent implements OnInit {
  loading = true;
  error: string | null = null;

  highlights: HighlightsResponse | null = null;

  teamRows: TeamRankRow[] = [];
  playerRows: PlayerRankRow[] = [];
  resultRows: EventResult[] = [];

  playersByTeam: { [teamName: string]: Player[] } = {};

  teamDisplayed   = ['rank','teamName','gold','silver','bronze','totalPoints'];
  playerDisplayed = ['rank','playerName','gold','silver','bronze','totalPoints'];
  resultDisplayed = ['eventName', 'firstPlace', 'secondPlace', 'thirdPlace'];
 

  constructor(private svc: ScoreboardService) {}

  async ngOnInit(): Promise<void> {
    try {
      const [highlights, teamRanked, playerRanked, players, eventResults] = await Promise.all([
        firstValueFrom(this.svc.getHighlights()),
        firstValueFrom(this.svc.getTeamRanked()),
        firstValueFrom(this.svc.getPlayerRanked()),
        firstValueFrom(this.svc.getPlayers()),
        firstValueFrom(this.svc.getEventResults())
      ]);

      this.highlights = highlights ?? null;
      this.teamRows   = teamRanked  ?? [];
      this.playerRows = playerRanked ?? [];
      this.resultRows = (eventResults ?? []);

      const teamNameById = new Map<number, string>(
        this.teamRows.map(t => [t.teamId, t.teamName])
      );

      const groups: { [teamName: string]: Player[] } = {};
      (players ?? []).forEach((p: Player) => {
        const teamName = teamNameById.get(p.teamId) ?? 'Unknown Team';
        if (!groups[teamName]) groups[teamName] = [];
        groups[teamName].push(p);
      });

      Object.values(groups).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));

      this.playersByTeam = groups;
    } catch (err) {
      console.error(err);
      this.error = 'Failed to load scoreboard';
    } finally {
      this.loading = false;
    }
  }
}
