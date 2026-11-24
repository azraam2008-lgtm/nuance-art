'use client';
import { createContext, useContext } from 'react';

export type Role = 'owner' | 'admin' | 'staff';
const RoleCtx = createContext<Role>('owner');
export const RoleProvider = RoleCtx.Provider;
/** Oturumdaki kullanıcının rolü (personel maliyet/kâr/fiyat görmez) */
export const useRole = () => useContext(RoleCtx);
export const useIsStaff = () => useContext(RoleCtx) === 'staff';
/** Personelin göremediği sayfalar */
export const STAFF_HIDDEN = ['/insights', '/profit', '/pricing', '/rules', '/ads', '/expenses', '/settings'];
