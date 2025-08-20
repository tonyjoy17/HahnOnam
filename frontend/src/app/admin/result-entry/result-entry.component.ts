// src/app/admin/result-entry/result-entry.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, AbstractControl, ReactiveFormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import {
  EventDto, TeamDto, PlayerDto,
  TeamResultPayload, IndividualResultPayload
} from '../../services/models';
import { forkJoin, firstValueFrom } from 'rxjs';

// Material
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';

function distinctValuesValidator(keys: string[]) {
  return (ctrl: AbstractControl) => {
    const vals = keys.map(k => ctrl.get(k)?.value).filter(v => v !== null && v !== undefined);
    if (vals.length <= 1) return null;
    return new Set(vals).size !== vals.length ? { notDistinct: true } : null;
  };
}

@Component({
  selector: 'app-result-entry',
  standalone: true, // ✅ make it standalone
  imports: [
    CommonModule,
    ReactiveFormsModule,
    // Material modules the template uses:
    MatFormFieldModule, MatSelectModule, MatButtonModule,
    MatCardModule, MatDividerModule, MatIconModule
  ],
  templateUrl: './result-entry.component.html',
  styleUrls: ['./result-entry.component.css']
})
export class ResultEntryComponent implements OnInit {
  form!: FormGroup;

  events: EventDto[] = [];
  teams: TeamDto[] = [];
  players: PlayerDto[] = [];
  playersByTeam = new Map<number, PlayerDto[]>();

  loading = false;
  submitState: 'idle'|'success'|'error' = 'idle';
  errorMsg: string | null = null;

  constructor(private fb: FormBuilder, private api: ApiService) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      event: [null as EventDto | null, Validators.required],
      winnerTeamId: [null as number | null],
      secondTeamId: [null as number | null],
      firstPlayerId: [null as number | null],
      secondPlayerId: [null as number | null],
      thirdPlayerId: [null as number | null],
    }, {
      validators: [
        distinctValuesValidator(['winnerTeamId','secondTeamId']),
        distinctValuesValidator(['firstPlayerId','secondPlayerId','thirdPlayerId'])
      ]
    });

    this.bootstrap();

    this.form.get('event')!.valueChanges.subscribe((ev: EventDto | null) => {
      const w = this.form.get('winnerTeamId')!;
      const s = this.form.get('secondTeamId')!;
      const p1 = this.form.get('firstPlayerId')!;
      const p2 = this.form.get('secondPlayerId')!;
      const p3 = this.form.get('thirdPlayerId')!;

      if (!ev) {
        [w, s, p1, p2, p3].forEach(c => { c.clearValidators(); c.updateValueAndValidity({ emitEvent: false }); });
        return;
      }

      if (ev.type === 'team') {
        p1.reset(); p2.reset(); p3.reset();
        w.setValidators([Validators.required]);
        s.setValidators([Validators.required]);
        p1.clearValidators(); p2.clearValidators(); p3.clearValidators();
      } else {
        w.reset(); s.reset();
        p1.setValidators([Validators.required]);
        p2.setValidators([Validators.required]);
        p3.setValidators([Validators.required]);
        w.clearValidators(); s.clearValidators();
      }
      [w, s, p1, p2, p3].forEach(c => c.updateValueAndValidity({ emitEvent: false }));
    });
  }

  private async bootstrap() {
    this.loading = true;
    this.errorMsg = null;
    try {
      const { events, teams, players } = await firstValueFrom(
        forkJoin({
          events: this.api.getEvents(),
          teams: this.api.getTeams(),
          players: this.api.getPlayers()
        })
      );

      this.events = events;
      this.teams = teams;
      this.players = players;

      const map = new Map<number, PlayerDto[]>();
      for (const p of this.players) {
        const arr = map.get(p.teamId) ?? [];
        arr.push(p);
        map.set(p.teamId, arr);
      }
      this.playersByTeam = map;
    } catch (e: any) {
      this.errorMsg = e?.message ?? 'Failed to load data';
    } finally {
      this.loading = false;
    }
  }

  get selectedEvent(): EventDto | null {
    return this.form.get('event')!.value as EventDto | null;
  }
  get isTeamEvent(): boolean {
    return this.selectedEvent?.type === 'team';
  }
  get isIndividualEvent(): boolean {
    return this.selectedEvent?.type === 'individual';
  }

  async submit() {
    this.submitState = 'idle';
    this.errorMsg = null;

    if (this.form.invalid || !this.selectedEvent) {
      this.form.markAllAsTouched();
      return;
    }

    const ev = this.selectedEvent;
    this.loading = true;

    try {
      if (ev.type === 'team') {
        const payload: TeamResultPayload = {
          eventId: ev.id,
          type: 'team',
          winnerTeamId: this.form.value.winnerTeamId!,
          secondTeamId: this.form.value.secondTeamId!
        };
        await firstValueFrom(this.api.postResults(ev.id, payload));
      } else {
        const payload: IndividualResultPayload = {
          eventId: ev.id,
          type: 'individual',
          firstPlayerId: this.form.value.firstPlayerId!,
          secondPlayerId: this.form.value.secondPlayerId!,
          thirdPlayerId: this.form.value.thirdPlayerId!
        };
        await firstValueFrom(this.api.postResults(ev.id, payload));
        await firstValueFrom(this.api.putMvp(ev.id, { eventId: ev.id, playerId: this.form.value.firstPlayerId! }));
      }

      this.submitState = 'success';
      this.form.reset();
    } catch (e: any) {
      this.submitState = 'error';
      this.errorMsg = e?.error?.message ?? e?.message ?? 'Submit failed';
    } finally {
      this.loading = false;
    }
  }
}
