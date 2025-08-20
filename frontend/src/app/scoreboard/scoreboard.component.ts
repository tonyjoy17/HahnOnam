import { Component, OnInit } from '@angular/core';
import {
  ScoreboardService,
  HighlightsResponse,
  TeamRankRow,
  PlayerRankRow,
  Player
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

  // tables
  teamRows: TeamRankRow[] = [];
  playerRows: PlayerRankRow[] = [];

  // players grouped by team name
  playersByTeam: { [teamName: string]: Player[] } = {};

  // displayed columns
  teamDisplayed   = ['rank','teamName','gold','silver','bronze','totalPoints'];
  playerDisplayed = ['rank','playerName','teamName','gold','silver','bronze','totalPoints'];

  constructor(private svc: ScoreboardService) {}

  async ngOnInit(): Promise<void> {
    try {
      // fetch everything in parallel
      const [highlights, teamRanked, playerRanked, players] = await Promise.all([
        firstValueFrom(this.svc.getHighlights()),
        firstValueFrom(this.svc.getTeamRanked()),
        firstValueFrom(this.svc.getPlayerRanked()),
        firstValueFrom(this.svc.getPlayers()),
      ]);

      // assign core data
      this.highlights = highlights ?? null;
      this.teamRows   = teamRanked  ?? [];
      this.playerRows = playerRanked ?? [];

      // build a quick lookup: teamId -> teamName (from ranked teams we already show)
      const teamNameById = new Map<number, string>(
        this.teamRows.map(t => [t.teamId, t.teamName])
      );

      // group players by team name
      const groups: { [teamName: string]: Player[] } = {};
      (players ?? []).forEach((p: Player) => {
        const teamName = teamNameById.get(p.teamId) ?? 'Unknown Team';
        if (!groups[teamName]) groups[teamName] = [];
        groups[teamName].push(p);
      });

      // optional: sort players alphabetically within each team
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
