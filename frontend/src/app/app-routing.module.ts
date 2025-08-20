import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ResultEntryComponent } from './admin/result-entry/result-entry.component';
import { ScoreboardComponent } from './scoreboard/scoreboard.component';


const routes: Routes = [
   { path: 'admin/results', component: ResultEntryComponent },
   { path: '', component: ScoreboardComponent },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
