import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { toPublicUser, type PublicUser } from './users.mapper';

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    const row = await this.users.findById(user.id);
    if (!row) {
      throw new NotFoundException('User not found');
    }
    return toPublicUser(row);
  }
}
