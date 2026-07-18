import { Routes } from '@angular/router';
import { Board } from './board/board';

/** Single-page board is the whole app for now. */
export const routes: Routes = [{ path: '', component: Board }];
