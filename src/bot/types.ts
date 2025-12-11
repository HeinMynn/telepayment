import { Context } from 'grammy';
import { IUser } from '@/models/User';

export interface BotContext extends Context {
    user: IUser;
}
