import React, {
  createContext, useCallback, useContext,
  useEffect, useState,
} from 'react';
import { useAuth } from './AuthContext';
import {
  userService, DbUser, Apartment,
  PhoneVerifyRequestResponse, PhoneVerifyConfirmResponse, OtpChannel,
} from '../api/userService';

interface UserServiceContextValue {
  dbUser: DbUser | null;
  apartments: Apartment[];
  isSyncing: boolean;
  syncError: string | null;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: { name?: string; phone?: string | null }) => Promise<void>;
  updateSettings: (data: {
    theme?: 'light' | 'dark' | 'system'; locale?: string;
    notify_sms?: boolean; notify_email?: boolean; notify_telegram?: boolean;
  }) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  removeAvatar: () => Promise<void>;
  sendEmailVerification: () => Promise<void>;
  checkEmailVerification: () => Promise<boolean>;
  requestPhoneVerification: (channel?: OtpChannel) => Promise<PhoneVerifyRequestResponse>;
  confirmPhoneVerification: (requestId: string, code: string) => Promise<PhoneVerifyConfirmResponse>;
  addApartment: (apartment_id: string) => Promise<void>;
  removeApartment: (apartment_id: string) => Promise<void>;
  addUnit: (node_id: string) => Promise<void>;
  removeUnit: (node_id: string) => Promise<void>;
}

const UserServiceContext = createContext<UserServiceContextValue | null>(null);

export function UserServiceProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const [dbUser,    setDbUser]    = useState<DbUser | null>(null);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [isSyncing,  setIsSyncing]  = useState(false);
  const [syncError,  setSyncError]  = useState<string | null>(null);

  useEffect(() => {
    if (!user || !token) {
      setDbUser(null);
      return;
    }
    setIsSyncing(true);
    setSyncError(null);
    Promise.all([
      userService.sync(token),
      userService.listApartments(token),
    ])
      .then(([synced, apts]) => {
        setDbUser(synced);
        setApartments(apts);
      })
      .catch((err: Error) => setSyncError(err.message))
      .finally(() => setIsSyncing(false));
  }, [user?.sub]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshProfile = useCallback(async () => {
    if (!token) return;
    const u = await userService.me(token);
    setDbUser(u);
  }, [token]);

  const updateProfile = useCallback(async (data: { name?: string; phone?: string | null }) => {
    if (!token) throw new Error('Not authenticated');
    const u = await userService.update(token, data);
    setDbUser(u);
  }, [token]);

  const updateSettings = useCallback(async (data: {
    theme?: 'light' | 'dark' | 'system'; locale?: string;
    notify_sms?: boolean; notify_email?: boolean; notify_telegram?: boolean;
  }) => {
    if (!token) throw new Error('Not authenticated');
    const u = await userService.update(token, data);
    setDbUser(u);
  }, [token]);

  const uploadAvatar = useCallback(async (file: File) => {
    if (!token) throw new Error('Not authenticated');
    const u = await userService.uploadAvatar(token, file);
    setDbUser(u);
  }, [token]);

  const removeAvatar = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    const u = await userService.removeAvatar(token);
    setDbUser(u);
  }, [token]);

  const sendEmailVerification = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    await userService.verifyEmail.send(token);
  }, [token]);

  const checkEmailVerification = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    const u = await userService.verifyEmail.check(token);
    setDbUser(u);
    return u.email_verified;
  }, [token]);

  const requestPhoneVerification = useCallback(async (channel?: OtpChannel) => {
    if (!token) throw new Error('Not authenticated');
    return userService.verifyPhone.request(token, channel);
  }, [token]);

  const confirmPhoneVerification = useCallback(async (requestId: string, code: string) => {
    if (!token) throw new Error('Not authenticated');
    const result = await userService.verifyPhone.confirm(token, requestId, code);
    if (result.verified && result.user) setDbUser(result.user);
    return result;
  }, [token]);

  const addApartment = useCallback(async (apartment_id: string) => {
    if (!token) throw new Error('Not authenticated');
    const u = await userService.addApartment(token, apartment_id);
    setDbUser(u);
  }, [token]);

  const removeApartment = useCallback(async (apartment_id: string) => {
    if (!token) throw new Error('Not authenticated');
    const u = await userService.removeApartment(token, apartment_id);
    setDbUser(u);
  }, [token]);

  const addUnit = useCallback(async (node_id: string) => {
    if (!token) throw new Error('Not authenticated');
    const u = await userService.units.add(token, node_id);
    setDbUser(u);
  }, [token]);

  const removeUnit = useCallback(async (node_id: string) => {
    if (!token) throw new Error('Not authenticated');
    const u = await userService.units.remove(token, node_id);
    setDbUser(u);
  }, [token]);

  return (
    <UserServiceContext.Provider
      value={{
        dbUser, apartments, isSyncing, syncError, refreshProfile, updateProfile, updateSettings,
        uploadAvatar, removeAvatar,
        sendEmailVerification, checkEmailVerification,
        requestPhoneVerification, confirmPhoneVerification,
        addApartment, removeApartment, addUnit, removeUnit,
      }}
    >
      {children}
    </UserServiceContext.Provider>
  );
}

export function useUserService(): UserServiceContextValue {
  const ctx = useContext(UserServiceContext);
  if (!ctx) throw new Error('useUserService must be used within <UserServiceProvider>');
  return ctx;
}
