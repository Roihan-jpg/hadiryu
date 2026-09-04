import { Injectable } from '@angular/core';
import { type QueryKey } from '@tanstack/angular-query-experimental';
import { appQueryClient } from './query-client';

@Injectable({ providedIn: 'root' })
export class QueryGateway {
  private readonly client = appQueryClient;

  get<T>(queryKey: QueryKey, queryFn: () => Promise<T>): Promise<T> {
    return this.client.fetchQuery({ queryKey, queryFn });
  }

  async write<T>(mutationFn: () => Promise<T>, keys: readonly QueryKey[]): Promise<T> {
    const result = await mutationFn();
    await Promise.all(keys.map((queryKey) => this.client.invalidateQueries({ queryKey })));
    return result;
  }
}
