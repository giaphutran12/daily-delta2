import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from './AuthContext';

const signUpSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type SignUpForm = z.infer<typeof signUpSchema>;

interface SignUpPageProps {
  onSwitchToLogin: () => void;
}

export function SignUpPage({ onSwitchToLogin }: SignUpPageProps) {
  const { signUp } = useAuth();
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<SignUpForm>({
    resolver: zodResolver(signUpSchema),
  });

  const onSubmit = async (data: SignUpForm) => {
    setServerError('');
    setLoading(true);
    const { error } = await signUp(data.email, data.password);
    if (error) setServerError(error);
    else setSuccess(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F5F5F5] px-4 antialiased">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-lg" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)' }}>
          <div className="flex flex-col px-7 py-8">

            <div className="text-center mb-5">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#1342FF] mb-3">
                <span className="text-white font-bold text-lg" style={{ fontFamily: "'Ubuntu', sans-serif" }}>D</span>
              </div>
              <h1 className="text-[19px] font-semibold text-black tracking-tight" style={{ fontFamily: "'Ubuntu', sans-serif" }}>
                Create Account
              </h1>
              <p className="text-[12px] text-black/45 mt-1" style={{ fontFamily: "'PT Serif', Georgia, serif" }}>
                Join Daily Delta
              </p>
            </div>

            {success ? (
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded bg-green-50 border border-green-200">
                  <span className="text-green-600 text-lg">✓</span>
                </div>
                <div className="w-full bg-green-50 border border-green-200 rounded px-3 py-2.5">
                  <p className="text-green-700 text-[12px] text-center leading-relaxed">
                    Account created! Check your email to confirm, then sign in.
                  </p>
                </div>
                <button onClick={onSwitchToLogin} className="text-[13px] text-[#1342FF] hover:text-[#0F35D9] font-semibold cursor-pointer">
                  Go to Sign In →
                </button>
              </div>
            ) : (
              <>
                <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-black/40 mb-1.5 uppercase tracking-wider" style={{ fontFamily: "'Departure Mono', monospace" }}>
                      Email
                    </label>
                    <input
                      type="email"
                      {...register('email')}
                      className="w-full h-9 px-3 bg-[#F5F5F5] border border-black/10 rounded text-[13px] text-black placeholder-black/30 focus:border-[#1342FF] focus:ring-1 focus:ring-[#1342FF]/15 focus:outline-none transition-all"
                      style={{ fontFamily: "'PT Serif', Georgia, serif" }}
                      placeholder="you@example.com"
                      autoFocus
                    />
                    {errors.email && <p className="text-red-600 text-[11px] mt-1">{errors.email.message}</p>}
                  </div>

                  <div>
                    <label className="block text-[10px] font-medium text-black/40 mb-1.5 uppercase tracking-wider" style={{ fontFamily: "'Departure Mono', monospace" }}>
                      Password
                    </label>
                    <input
                      type="password"
                      {...register('password')}
                      className="w-full h-9 px-3 bg-[#F5F5F5] border border-black/10 rounded text-[13px] text-black placeholder-black/30 focus:border-[#1342FF] focus:ring-1 focus:ring-[#1342FF]/15 focus:outline-none transition-all"
                      style={{ fontFamily: "'PT Serif', Georgia, serif" }}
                      placeholder="Min 8 characters"
                    />
                    {errors.password && <p className="text-red-600 text-[11px] mt-1">{errors.password.message}</p>}
                  </div>

                  <div>
                    <label className="block text-[10px] font-medium text-black/40 mb-1.5 uppercase tracking-wider" style={{ fontFamily: "'Departure Mono', monospace" }}>
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      {...register('confirmPassword')}
                      className="w-full h-9 px-3 bg-[#F5F5F5] border border-black/10 rounded text-[13px] text-black placeholder-black/30 focus:border-[#1342FF] focus:ring-1 focus:ring-[#1342FF]/15 focus:outline-none transition-all"
                      style={{ fontFamily: "'PT Serif', Georgia, serif" }}
                      placeholder="Repeat your password"
                    />
                    {errors.confirmPassword && <p className="text-red-600 text-[11px] mt-1">{errors.confirmPassword.message}</p>}
                  </div>

                  {serverError && (
                    <div className="bg-red-50 border border-red-200 rounded px-3 py-2">
                      <p className="text-red-600 text-[12px]">{serverError}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-1 w-full h-9 bg-[#1342FF] hover:bg-[#0F35D9] active:scale-[0.98] disabled:opacity-50 text-white text-[10px] font-semibold rounded transition-all cursor-pointer uppercase tracking-wider"
                    style={{ fontFamily: "'Departure Mono', monospace" }}
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Creating account...
                      </span>
                    ) : 'Sign Up'}
                  </button>
                </form>

                <div className="flex items-center gap-3 mt-4 mb-3">
                  <div className="flex-1 h-px bg-black/10" />
                  <span className="text-[10px] text-black/30 uppercase tracking-widest" style={{ fontFamily: "'Departure Mono', monospace" }}>or</span>
                  <div className="flex-1 h-px bg-black/10" />
                </div>

                <p className="text-center text-[12px] text-black/50" style={{ fontFamily: "'PT Serif', Georgia, serif" }}>
                  Already have an account?{' '}
                  <button onClick={onSwitchToLogin} className="text-[#1342FF] hover:text-[#0F35D9] font-semibold cursor-pointer">
                    Sign In
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
