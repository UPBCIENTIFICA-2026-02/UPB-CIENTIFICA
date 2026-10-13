"""Ejemplo de trabajo HPC en Python con mpi4py (en el clúster: apt install python3-mpi4py).

Aproxima pi repartiendo la integral entre los procesos y la reúne con reduce.
Parámetro opcional: pasos=<n>.
"""
import sys

from mpi4py import MPI

comm = MPI.COMM_WORLD
rango, total = comm.Get_rank(), comm.Get_size()
pasos = next((int(a.split("=", 1)[1]) for a in sys.argv[1:] if a.startswith("pasos=")), 10_000_000)

h = 1.0 / pasos
parcial = h * sum(4.0 / (1.0 + (h * (i + 0.5)) ** 2) for i in range(rango, pasos, total))
pi = comm.reduce(parcial, op=MPI.SUM, root=0)
print(f"rango {rango}/{total} en {MPI.Get_processor_name()}: {parcial:.12f}")
if rango == 0:
    print(f"pi ~= {pi:.15f} con {pasos} pasos")
